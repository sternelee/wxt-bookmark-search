# 2026-10-11 迭代记录：自建 Cloudflare Markdown 服务（替代不稳定的第三方 reader）

## 问题

内容提取依赖的两个第三方服务都不稳定：

1. **markdown.new**：共享限流，返回 `429` / `439`（详见上轮 `aab62e6` 的修复——限流后连错误都不上报）
2. **Jina Reader**：同样共享限流，`429` 频发

用户自建服务后即用自己的 Cloudflare 账号配额，没有共享限流问题。

## 方案

参考 Cloudflare 官方博客 [Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/)：
官方对「Cloudflare 网络之外、或内容源未启用 Markdown for Agents」的场景，推荐 **Workers AI `toMarkdown()`**（支持 HTML / PDF / 图片等任意格式）。

## 改动

### 1. 新增 `workers/markdown-reader/`（独立 Worker 子项目）

- `GET /markdown?url=<encoded>` → `{ success, markdown, mimetype }`，附 `x-markdown-tokens` 响应头
- 流程：URL 校验（防 SSRF，拒绝内网/私网/非标准端口）→ 服务端抓取（`Accept: text/markdown, text/html`，
  上游是启用了 Markdown for Agents 的 CF 站点时直接拿回 markdown，跳过转换）→ `env.AI.toMarkdown()` 转换
- 10 MB 响应体上限、20s 总超时、CORS 放行
- 可选 `AUTH_TOKEN` 共享令牌（`wrangler secret put`），不设置则公开可调用
- `wrangler deploy --dry-run` 验证通过（bundle 6.5 KiB）

### 2. 扩展接入（`src/` + `entrypoints/`）

- `Settings.readerBackend` 增加 `"cloudflare"`，新增 `cloudflareReaderUrl` / `cloudflareReaderToken`
- `src/indexer.ts`：`fetchWithCloudflareReader()`（与 markdown.new / Jina 相同的错误处理与
  `stripYamlFrontmatter` / `extractFromMarkdown` 后处理；独立 RateLimiter 应对 Workers AI 配额 429）；
  `fetchPageContent` 分发三选一，互不兜底（保持既有策略不变）
- 设置页：选择「自建 Cloudflare Markdown 服务」时显示服务地址 / 令牌输入框；i18n 四语言补齐
- `wxt.config.ts`：`host_permissions` 放行 `https://*.workers.dev/*`（默认部署域；自定义域名需自行追加）

## 部署（用户操作）

```bash
cd workers/markdown-reader
npm install
npx wrangler deploy
npx wrangler secret put AUTH_TOKEN   # 部署后立即设置，防止被盗用配额
```

然后在扩展设置页填入 `https://flowsearch-markdown-reader.<子域>.workers.dev` 与令牌。

## 验证

- [x] `pnpm compile`（tsc --noEmit）通过
- [x] Worker `wrangler deploy --dry-run` 通过
- [ ] 用户部署后：设置页选择自建服务 → 对新书签跑一次索引 → 确认 `[indexer] cloudflare reader: success` 日志
- [ ] `GET /health` 与带令牌 / 不带令牌的 401 行为
