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
  try {
    if (!DIFY_API_KEY) {
      console.error("Missing DIFY_API_KEY");
      return res.send("success");
    }

    const parsed = await xml2js.parseStringPromise(req.body, {
      explicitArray: false,
      trim: true
    });

    const msg = parsed.xml;
    const fromUser = msg.FromUserName;
    const toUser = msg.ToUserName;
    const msgType = msg.MsgType;

    if (msgType !== "text") {
      return res.send("success");
    }

    const userMessage = msg.Content || "";

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
        timeout: 15000
      }
    );

    const answer = difyRes.data.answer || "我暂时没有生成回复。";

    const replyXml = `<xml>
<ToUserName><![CDATA[${safeCdata(fromUser)}]]></ToUserName>
<FromUserName><![CDATA[${safeCdata(toUser)}]]></FromUserName>
<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${safeCdata(answer)}]]></Content>
</xml>`;

    res.type("application/xml").send(replyXml);
  } catch (err) {
    console.error("Wechat webhook error:", err.response?.data || err.message);
    res.send("success");
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
