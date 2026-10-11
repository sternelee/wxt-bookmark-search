# Flow Search · Markdown Reader Worker

自托管的 **URL → Markdown** 转换服务，替代不稳定的第三方提取服务（markdown.new 限流 429/439、Jina Reader 限流）。

方案参考 Cloudflare [Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/)：

1. 校验目标 URL（仅公网 http/https，拒绝内网/私网地址）
2. 服务端抓取上游页面，请求头携带 `Accept: text/markdown` —— 上游是启用了
   Markdown for Agents 的 Cloudflare 站点时直接拿回 markdown（零成本快速路径）
3. 否则通过 Workers AI `env.AI.toMarkdown()` 转换（支持 HTML、PDF、图片等格式）

## 接口

```
GET /markdown?url=<encoded-url>          # 转换（设置 AUTH_TOKEN 后需带 Authorization: Bearer <token>）
GET /health                              # 健康检查
```

成功响应（`200`，含 `x-markdown-tokens` 响应头）：

```json
{ "success": true, "markdown": "# ...", "mimetype": "text/markdown" }
```

失败响应：`{ "success": false, "error": "..." }`（400/401/403/405/413/422/500/502）。

## 部署

```bash
cd workers/markdown-reader
npm install
npx wrangler deploy
```

部署完成后**立即设置访问令牌**（Worker 默认公开可调用，会被盗用消耗你的 Workers AI 配额）：

```bash
npx wrangler secret put AUTH_TOKEN   # 交互式输入，值不会进代码库
```

然后在扩展设置页 → 内容提取方式 → 选择「自建 Cloudflare Markdown 服务」，填入
`https://flowsearch-markdown-reader.<你的子域>.workers.dev` 和令牌即可。

## 本地开发

```bash
npm install
npx wrangler dev          # 注意：Workers AI 始终在云端执行，会消耗配额
curl 'http://localhost:8787/markdown?url=https://blog.cloudflare.com/markdown-for-agents/'
```

## 扩展侧权限

扩展默认部署域 `*.workers.dev` 已在 `wxt.config.ts` 的 `host_permissions` 中放行。
若绑定自定义域名，需自行把域名加入 `host_permissions` 后重新构建。
