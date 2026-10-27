# 2026-10-27 迭代记录：移除 markdown.new 与自建 Cloudflare reader 后端（本地 WASM 设为默认）

## 问题

1. **markdown.new（Cloudflare AI Markdown）**：共享限流不稳定，且内容要经第三方服务（隐私顾虑）
2. **自建 Cloudflare Markdown 服务**（见 `2026-10-11` 接入记录）：需要单独部署与维护一个 Worker，
   凭据（`cloudflareReaderUrl` / `cloudflareReaderToken`）留在扩展存储里也是卫生负担
3. 本地 WASM 后端（`2026-10-26` 接入）已可完全离线完成 HTML → Markdown 转换，两个远程后端失去必要性

## 方案

彻底移除两个后端，`readerBackend` 收窄为 `"wasm" | "jina"`：

- **本地 WASM 为默认**（零第三方请求），**Jina 为唯一远程选项**
- 保持既有「各后端互不兜底」语义不变

## 改动

### 1. 移除 markdown.new 后端

- `Settings.readerBackend` 删除 `"markdown"` 值；`markdownLimiter`、`fetchWithMarkdownNew` 及
  `wxt.config.ts` 中 `https://md.dhr.wtf/*` host permission 一并移除
- 限流识别（`isRateLimitError`）同步删除 markdown.new 专属的 `439` 码

### 2. 移除自建 Cloudflare Markdown 服务

- `Settings` 删除 `cloudflareReaderUrl` / `cloudflareReaderToken`；`fetchWithCloudflareReader`、
  `cloudflareReaderLimiter` 移除
- `workers/markdown-reader/` 子项目整体删除；`https://markdown-reader.leeapp.dev/*` host permission 移除
- **注意**：已部署的 Worker 不会被扩展卸载，需要用户自行 `wrangler delete` 下线并轮换 `AUTH_TOKEN`

### 3. 旧设置迁移（`src/db.ts` `getSettings()`）

- 存量 `readerBackend: "markdown" | "cloudflare"` 读取时回落为 `"wasm"`
- 检测到旧后端值或残留的 `cloudflareReader*` 字段时**立即写回 storage**，
  确保旧凭据从 `browser.storage.local` 中真正清除（进程内标记保证只写一次）

### 4. 配套更新

- `ReaderBackend` 类型显式导出（`src/types.ts`），设置页选项表 + 归一化同步收窄
- i18n 四语言（zh-CN / en / ja / ko）删除两个后端的 label 与 hint 键，`readerBackendHint` 改写
- AGENTS.md / CLAUDE.md / README.md 提取链文档同步更新
- `.gitignore` 新增 `.wrangler/`、`.dev.vars*`（原规则随 workers/ 子目录删除而丢失）

## 同批：Orama 启动维度守卫（c3e40c2）

- `upsertSearchEngine` / `upsertSearchEngineBatch` 增加 ready 门控：写入前等待
  `initSearchAndPopulate` 完成，避免启动窗口内写入 1024 维 schema 前的空引擎
- 新增 `assertVectorDimensions`：upsert 前校验记录向量维度，**在 `removeMultiple` 之前抛错**，
  防止「先删后拒」导致索引丢失
- WASM init 改为对象形式 `{ module_or_path: fetch(url) }`，对齐 wasm-bindgen web 构建签名，
  消除 deprecated 参数警告

## 验证

- `pnpm compile` / `pnpm build` 通过；`background.js` 无内联 base64 wasm（4.48MB），
  产物根含 `html_to_markdown_wasm_bg.wasm`
- ce-code-review 13 维度审查（run `20261027-222134-778aa7ff`）：合并去重后 P1×1 / P2×3 / P3×5，
  safe_auto 修复 8 项已应用，其余进入 gated 队列由用户路由
