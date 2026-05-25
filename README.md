# Railway 每日微信日报配置

把 `scripts/send_daily_report.js` 复制到你的 `wechat-dify` 仓库同名路径。

然后把 `package.json` 的 `scripts` 改成：

```json
{
  "scripts": {
    "start": "node index.js",
    "daily-report": "node scripts/send_daily_report.js"
  }
}
```

## Railway 变量

你现在已有：

- `DIFY_API_KEY`
- `DIFY_API_URL`
- `WECHAT_TOKEN`

还需要新增：

- `WECHAT_APP_ID`: 微信测试公众号 appID
- `WECHAT_APP_SECRET`: 微信测试公众号 appsecret
- `WECHAT_OPENID`: 接收日报的用户 openid

可选：

- `DAILY_REPORT_QUERY`: 默认是 `今日日报`
- `DIFY_USER`: 默认使用 `WECHAT_OPENID`

## Railway Cron 设置

新建一个 Railway Service，仍然选择这个 GitHub 仓库。

Start Command 填：

```text
npm run daily-report
```

Cron Schedule 填：

```text
0 0 * * *
```

Railway Cron 使用 UTC 时间，`0 0 * * *` 对应北京时间每天早上 8 点。

## 微信限制

测试公众号用客服消息接口主动发消息时，通常要求用户近期和公众号有互动，常见是 48 小时窗口。如果长时间没有给测试公众号发消息，定时日报可能会发送失败。
