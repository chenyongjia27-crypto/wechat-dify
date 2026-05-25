# wechat-dify

这个服务有两个用途：

1. 保留原来的微信测试公众号回调：用户给测试公众号发消息后，服务会把消息转发给 Dify，并把 Dify 回复返回给微信。
2. 新增每日主动推送接口：Dify 的定时 Workflow 可以调用 Railway 的 `/send-daily`，再由这个服务把今日日报发送到微信测试公众号用户。

## Railway 服务地址

当前 Railway 域名：

```text
https://wechat-dify-production.up.railway.app
```

## 接口

### 健康检查

```http
GET /health
```

### 微信测试公众号回调

```http
GET /wechat
POST /wechat
```

微信测试公众号后台的服务器地址填：

```text
https://wechat-dify-production.up.railway.app/wechat
```

Token 使用 Railway 变量 `WECHAT_TOKEN`。

### Dify 每日主动推送

```http
POST /send-daily
Content-Type: application/json
```

Dify 可以传已经生成好的日报内容：

```json
{
  "content": "这里是 Dify 生成的今日日报"
}
```

也可以只触发发送服务自己调用 Dify 生成日报：

```json
{
  "query": "今日日报"
}
```

如果设置了 `PUSH_SECRET`，调用时需要带上其中一种认证方式：

```http
Authorization: Bearer 你的_PUSH_SECRET
```

或：

```http
x-push-secret: 你的_PUSH_SECRET
```

## Railway 变量

已有并继续使用：

- `DIFY_API_KEY`: Dify 应用 API Key
- `DIFY_API_URL`: 默认可填 `https://api.dify.ai/v1`
- `WECHAT_TOKEN`: 微信测试公众号回调用的 Token

新增主动推送需要：

- `WECHAT_APP_ID`: 微信测试公众号 appID
- `WECHAT_APP_SECRET`: 微信测试公众号 appsecret
- `WECHAT_OPENID`: 接收日报的用户 openid

建议新增：

- `PUSH_SECRET`: 保护 `/send-daily` 的调用密钥，防止别人乱调用你的推送接口

可选：

- `DIFY_DAILY_QUERY`: 默认是 `今日日报`
- `DIFY_USER`: 调用 Dify 时使用的 user，默认使用 `WECHAT_OPENID` 或 `daily-report-scheduler`

## Dify Workflow 配置

在 Dify 里使用 Workflow：

1. 开始节点选择 `定时触发器`。
2. 每日执行时间设为北京时间早上 7 点。当前 Dify 页面若显示 `UTC-5`，对应时间是 `06:00 PM (UTC-5)`。
3. HTTP 请求节点调用现有 Dify 应用生成 `今日日报`。
4. 再新增一个 HTTP 请求节点调用 Railway：

```text
POST https://wechat-dify-production.up.railway.app/send-daily
```

Headers：

```text
Content-Type: application/json
Authorization: Bearer 你的_PUSH_SECRET
```

Body 示例：

```json
{
  "content": "{{上一个节点生成的日报内容}}"
}
```

如果你暂时不想在 Dify 里解析上一个节点输出，也可以让 Railway 端自己调用 Dify：

```json
{
  "query": "今日日报"
}
```

## 微信限制

微信测试公众号使用客服消息接口主动发消息时，通常要求接收用户近期和公众号有互动，常见是 48 小时窗口。如果很久没有给测试公众号发消息，主动推送可能会被微信拒绝。
