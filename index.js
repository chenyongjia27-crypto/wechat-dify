const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const xml2js = require("xml2js");

const app = express();

const WECHAT_TOKEN = process.env.WECHAT_TOKEN || "yongjia";
const DIFY_API_KEY = process.env.DIFY_API_KEY;
const DIFY_API_URL = process.env.DIFY_API_URL || "https://api.dify.ai/v1";

app.use(express.text({ type: "*/*" }));

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
  return `<xml>
<ToUserName><![CDATA[${safeCdata(toUser)}]]></ToUserName>
<FromUserName><![CDATA[${safeCdata(fromUser)}]]></FromUserName>
<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${safeCdata(limitText(content))}]]></Content>
</xml>`;
}

app.get("/", (req, res) => {
  res.send("wechat-dify server is running");
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

    if (!DIFY_API_KEY) {
      const reply = buildTextReply(
        fromUser,
        toUser,
        "Dify API Key 还没有配置好。"
      );
      return res.type("application/xml").send(reply);
    }

    const difyRes = await axios.post(
      `${DIFY_API_URL}/chat-messages`,
      {
        inputs: {},
        query: userMessage,
        response_mode: "blocking",
        user: fromUser
      },
      {
        headers: {
          Authorization: `Bearer ${DIFY_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 12000
      }
    );

    const answer = difyRes.data.answer || "我暂时没有生成出回复。";
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

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
