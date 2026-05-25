const axios = require("axios");

const DIFY_API_KEY = process.env.DIFY_API_KEY;
const DIFY_API_URL = process.env.DIFY_API_URL || "https://api.dify.ai/v1";
const DIFY_USER = process.env.DIFY_USER || process.env.WECHAT_OPENID || "daily-report-cron";
const DAILY_REPORT_QUERY = process.env.DAILY_REPORT_QUERY || "今日日报";

const WECHAT_APP_ID = process.env.WECHAT_APP_ID;
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET;
const WECHAT_OPENID = process.env.WECHAT_OPENID;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function chunkText(text, maxLength = 1500) {
  const content = String(text || "").trim();
  if (!content) return ["今日日报暂时没有生成内容。"];

  const chunks = [];
  for (let index = 0; index < content.length; index += maxLength) {
    chunks.push(content.slice(index, index + maxLength));
  }
  return chunks;
}

async function getWechatAccessToken() {
  const response = await axios.get("https://api.weixin.qq.com/cgi-bin/token", {
    params: {
      grant_type: "client_credential",
      appid: WECHAT_APP_ID,
      secret: WECHAT_APP_SECRET
    },
    timeout: 10000
  });

  if (!response.data.access_token) {
    throw new Error(`Failed to get WeChat access_token: ${JSON.stringify(response.data)}`);
  }

  return response.data.access_token;
}

async function askDifyForDailyReport() {
  const response = await axios.post(
    `${DIFY_API_URL}/chat-messages`,
    {
      inputs: {},
      query: DAILY_REPORT_QUERY,
      response_mode: "blocking",
      user: DIFY_USER
    },
    {
      headers: {
        Authorization: `Bearer ${DIFY_API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 90000
    }
  );

  return response.data.answer || "今日日报暂时没有生成内容。";
}

async function sendWechatText(accessToken, content) {
  const response = await axios.post(
    "https://api.weixin.qq.com/cgi-bin/message/custom/send",
    {
      touser: WECHAT_OPENID,
      msgtype: "text",
      text: { content }
    },
    {
      params: { access_token: accessToken },
      timeout: 10000
    }
  );

  if (response.data.errcode !== 0) {
    throw new Error(`Failed to send WeChat message: ${JSON.stringify(response.data)}`);
  }
}

async function main() {
  requireEnv("DIFY_API_KEY", DIFY_API_KEY);
  requireEnv("WECHAT_APP_ID", WECHAT_APP_ID);
  requireEnv("WECHAT_APP_SECRET", WECHAT_APP_SECRET);
  requireEnv("WECHAT_OPENID", WECHAT_OPENID);

  console.log("Generating daily report with Dify...");
  const report = await askDifyForDailyReport();

  console.log("Fetching WeChat access token...");
  const accessToken = await getWechatAccessToken();

  const chunks = chunkText(report);
  console.log(`Sending daily report to WeChat in ${chunks.length} message(s)...`);

  for (const chunk of chunks) {
    await sendWechatText(accessToken, chunk);
  }

  console.log("Daily report sent successfully.");
}

main().catch((error) => {
  console.error(error.response?.data || error.message);
  process.exit(1);
});
