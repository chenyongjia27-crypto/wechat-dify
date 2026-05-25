const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const xml2js = require("xml2js");

const app = express();

const WECHAT_TOKEN = process.env.WECHAT_TOKEN || "yongjia";
const WECHAT_APP_ID = process.env.WECHAT_APP_ID;
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET;
const WECHAT_OPENID = process.env.WECHAT_OPENID;
const PUSH_SECRET = process.env.PUSH_SECRET;

const DIFY_API_KEY = process.env.DIFY_API_KEY;
const DIFY_API_URL = process.env.DIFY_API_URL || "https://api.dify.ai/v1";
const DIFY_DAILY_QUERY = process.env.DIFY_DAILY_QUERY || "今日日报";
const DIFY_USER = process.env.DIFY_USER || WECHAT_OPENID || "daily-report-scheduler";

app.use(express.text({ type: "*/*", limit: "2mb" }));

let cachedWechatToken = null;
let cachedWechatTokenExpiresAt = 0;

function checkSignature(signature, timestamp, nonce) {
  const str = [WECHAT_TOKEN, timestamp, nonce].sort().join("");
  const sha1 = crypto.createHash("sha1").update(str).digest("hex");
  return sha1 === signature;
}

function safeCdata(text) {
  return String(text || "").replace(/\]\]>/g, "]]]]><![CDATA[>");
}

function limitText(text, max = 1500) {
  const str = String(text || "");
  if (str.length <= max) return str;
  return str.slice(0, max) + "\n\n内容较长，已截断。";
}

function buildTextReply(toUser, fromUser, content) {
  return "<xml>\n" +
    "<ToUserName><![CDATA[" + safeCdata(toUser) + "]]></ToUserName>\n" +
    "<FromUserName><![CDATA[" + safeCdata(fromUser) + "]]></FromUserName>\n" +
    "<CreateTime>" + Math.floor(Date.now() / 1000) + "</CreateTime>\n" +
    "<MsgType><![CDATA[text]]></MsgType>\n" +
    "<Content><![CDATA[" + safeCdata(limitText(content)) + "]]></Content>\n" +
    "</xml>";
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;

  try {
    return JSON.parse(req.body);
  } catch {
    return { content: String(req.body) };
  }
}

function hasPushAccess(req) {
  if (!PUSH_SECRET) return true;

  const auth = req.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const headerSecret = req.get("x-push-secret") || "";
  const querySecret = req.query.secret || "";

  return [bearer, headerSecret, querySecret].includes(PUSH_SECRET);
}

function getDifyAnswer(data) {
  if (!data) return "";
  if (typeof data === "string") {
    try {
      return getDifyAnswer(JSON.parse(data));
    } catch {
      return data;
    }
  }

  return data.answer || data.output || data.text || data.content || data.report || "";
}

async function callDify(query, user) {
  if (!DIFY_API_KEY) {
    throw new Error("DIFY_API_KEY is not configured");
  }

  const difyRes = await axios.post(
    DIFY_API_URL + "/chat-messages",
    {
      inputs: {},
      query,
      response_mode: "blocking",
      user
    },
    {
      headers: {
        Authorization: "Bearer " + DIFY_API_KEY,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );

  return difyRes.data;
}

async function getWechatAccessToken() {
  if (cachedWechatToken && Date.now() < cachedWechatTokenExpiresAt) {
    return cachedWechatToken;
  }

  if (!WECHAT_APP_ID || !WECHAT_APP_SECRET) {
    throw new Error("WECHAT_APP_ID or WECHAT_APP_SECRET is not configured");
  }

  const tokenRes = await axios.get("https://api.weixin.qq.com/cgi-bin/token", {
    params: {
      grant_type: "client_credential",
      appid: WECHAT_APP_ID,
      secret: WECHAT_APP_SECRET
    },
    timeout: 15000
  });

  if (!tokenRes.data.access_token) {
    throw new Error("Wechat token error: " + JSON.stringify(tokenRes.data));
  }

  cachedWechatToken = tokenRes.data.access_token;
  cachedWechatTokenExpiresAt = Date.now() + (tokenRes.data.expires_in - 300) * 1000;
  return cachedWechatToken;
}

async function sendWechatText(openid, content) {
  if (!openid) {
    throw new Error("Missing receiver openid. Set WECHAT_OPENID or pass openid in request body.");
  }

  const accessToken = await getWechatAccessToken();
  const message = limitText(content, 1800);

  const sendRes = await axios.post(
    "https://api.weixin.qq.com/cgi-bin/message/custom/send",
    {
      touser: openid,
      msgtype: "text",
      text: { content: message }
    },
    {
      params: { access_token: accessToken },
      timeout: 15000
    }
  );

  if (sendRes.data.errcode !== 0) {
    throw new Error("Wechat send error: " + JSON.stringify(sendRes.data));
  }

  return sendRes.data;
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "wechat-dify",
    endpoints: ["GET /wechat", "POST /wechat", "POST /send-daily", "GET /health"]
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/wechat", (req, res) => {
  const { signature, timestamp, nonce, echostr } = req.query;

  if (checkSignature(signature, timestamp, nonce)) {
    return res.send(echostr);
  }

  return res.status(403).send("Invalid signature");
});

app.post("/wechat", async (req, res) => {
  let fromUser = "";
  let toUser = "";

  try {
    const parsed = await xml2js.parseStringPromise(req.body, {
      explicitArray: false,
      trim: true
    });

    const msg = parsed.xml;
    fromUser = msg.FromUserName;
    toUser = msg.ToUserName;

    if (msg.MsgType !== "text") {
      return res.send("success");
    }

    const userMessage = msg.Content || "";
    const difyData = await callDify(userMessage, fromUser);
    const answer = getDifyAnswer(difyData) || "我暂时没有生成出回复。";
    const replyXml = buildTextReply(fromUser, toUser, answer);

    return res.type("application/xml").send(replyXml);
  } catch (err) {
    console.error("Wechat webhook error:", err.response?.data || err.message);

    if (fromUser && toUser) {
      const fallback = buildTextReply(
        fromUser,
        toUser,
        "这个任务处理时间有点久，微信接口可能超时了。你可以稍后再试，或者发一个更短的问题。"
      );
      return res.type("application/xml").send(fallback);
    }

    return res.send("success");
  }
});

app.post("/send-daily", async (req, res) => {
  try {
    if (!hasPushAccess(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const body = parseBody(req);
    const openid = body.openid || body.to || WECHAT_OPENID;

    let content = getDifyAnswer(body.report) || getDifyAnswer(body.dify_response) || body.content || body.text || "";

    if (!content) {
      const query = body.query || DIFY_DAILY_QUERY;
      const user = body.user || DIFY_USER;
      const difyData = await callDify(query, user);
      content = getDifyAnswer(difyData);
    }

    if (!content) {
      return res.status(400).json({ ok: false, error: "No report content generated" });
    }

    const wechatResult = await sendWechatText(openid, content);

    return res.json({
      ok: true,
      sent: true,
      openid,
      wechat: wechatResult,
      preview: limitText(content, 120)
    });
  } catch (err) {
    console.error("Daily report push error:", err.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      error: err.message,
      detail: err.response?.data || null
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("Server running on port " + port);
});
