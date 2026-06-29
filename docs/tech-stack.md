# 持续知识工作流系统技术栈选型

> 版本：v0.2
> 状态：技术选型草案
> 阶段：MVP 技术栈设计
> 更新日期：2026-06-27

## 1. 选型结论

MVP 暂不实现 Electron 桌面应用。

第一阶段采用本地 Web 应用形态：

```text
Vite + React + TypeScript + TailwindCSS
  + Node.js Local Backend
  + SQLite Workspace
  + Obsidian Web Clipper
  + File Watcher
  + AI SDK Provider Adapter
```

核心取舍：

- 前端必须轻、快、容易迭代。
- 后端必须本地优先，能安全访问用户 Vault。
- AI 配置要可替换，但 MVP 不做过重多模型编排。
- AI 默认只生成 Proposal，不默认生成整理后 Markdown。
- Patch 只在用户选择具体 Vault 修改动作后按需生成。
- Vault 写入必须通过安全层，AI 不直接操作文件。
- Staging 是可选预览区，不是每个 Case 的必经处理空间。
- Electron 延后，先验证核心工作流价值。

## 2. MVP 不做 Electron 的原因

Electron 很适合最终产品形态，但不是 MVP 的第一优先级。

暂不实现 Electron 的原因：

- 打包、签名、自动更新、权限、跨平台差异会显著增加复杂度。
- MVP 首要验证的是知识工作流闭环，而不是桌面分发体验。
- 本地 Web 服务已经可以验证 Vault 监听、AI 提案、审批和安全写入。
- 后续如果需要桌面化，可以参考 `snorkeling` 的 Electron + Vite + React 工程结构。

MVP 推荐形态：

```text
用户启动本地 Node 服务
-> 打开 http://localhost:xxxx
-> 连接 Obsidian Vault
-> 处理 Case 队列
```

后续桌面化路径：

```text
本地 Web App 稳定后
-> Electron 包装 Web Console + Backend
-> 增加托盘、自动启动、自动更新、密钥安全存储
```

## 3. 前端技术栈

### 3.1 Vite

选择：必须采用。

用途：

- Web Console 开发服务器。
- 前端构建。
- 快速 HMR。
- 后续可被 Electron 复用。

理由：

- Vite 是现代前端项目的轻量构建底座。
- 和 React、TypeScript、TailwindCSS 组合成熟。
- `snorkeling` 已经采用 `electron-vite`，后续桌面化迁移路径清晰。

注意：

- MVP 先用普通 Vite，不引入 Electron Vite。
- 不需要 Next.js，除非后续要做 SSR 或云端部署。

### 3.2 React

选择：推荐采用。

用途：

- Dashboard。
- Case Detail。
- Proposal Review。
- Patch Preview。
- Settings。

理由：

- 生态成熟，组件库丰富。
- `snorkeling` 和 `next-ai-draw-io` 都使用 React。
- 后续可复用 AI SDK React hooks 和大量 UI 组件。

### 3.3 TypeScript

选择：必须采用。

用途：

- 前后端共享类型。
- Case、Proposal、Patch、Snapshot、Settings 的结构约束。
- API 输入输出类型。
- AI 结构化输出校验。

理由：

- 本项目领域对象多，状态和边界复杂，必须用类型系统降低错误率。
- Node / Obsidian / Vite / AI SDK 生态都天然支持 TypeScript。

### 3.4 TailwindCSS

选择：必须采用。

用途：

- Web Console 样式系统。
- Dashboard、表单、状态卡、Patch Preview 等 UI。

理由：

- 适合快速构建工具型界面。
- 和 Vite 集成简单。
- `snorkeling` 也使用 TailwindCSS，可作为本地工具类产品的参考。

注意：

- 不要做营销式页面。
- UI 应该是密度适中、安静、任务导向的控制台。

## 4. UI 组件与状态管理

### 4.1 UI 组件

推荐：

```text
Radix UI 或 shadcn/ui
lucide-react
clsx / tailwind-merge
```

用途：

- Dialog。
- Tabs。
- Select。
- Dropdown。
- Tooltip。
- Toast。
- Command。
- Switch。
- Form controls。

理由：

- 不自研基础交互组件。
- 适合本地控制台产品。
- 能保持较高可访问性基础。

### 4.2 前端数据请求

推荐：

```text
TanStack Query
```

用途：

- Case 列表查询。
- Case Detail 查询。
- Worker 任务状态轮询。
- Settings 加载和保存。

理由：

- 异步状态和缓存管理成熟。
- 能减少手写 loading/error/refetch 逻辑。

### 4.3 路由

推荐：

```text
React Router
```

理由：

- MVP 页面少，React Router 简单直接。
- 后续如果强类型路由需求明显，再考虑 TanStack Router。

## 5. 本地后端技术栈

### 5.1 Node.js + TypeScript

选择：必须采用。

理由：

- 与前端共享语言和类型。
- 与 Obsidian / Web Clipper / AI SDK 生态贴合。
- MVP 比 Go + TS 双栈更轻。

### 5.2 Fastify

选择：推荐采用。

用途：

- Case API。
- Proposal API。
- Patch API。
- Approval API。
- Settings API。
- Health Check。

理由：

- 轻量、性能好、TypeScript 友好。
- 适合作为本地 API 服务。

注意：

- HTTP 请求只做协调，不执行长任务。
- AI 分析、Patch 生成、Apply、Rollback 等长任务交给后台任务模块。

### 5.3 API Schema

推荐：

```text
Zod
```

用途：

- API 请求校验。
- Settings 校验。
- AI 输出校验。
- Patch Manifest 校验。

理由：

- 前后端可共享 schema。
- 对 AI 结构化输出尤其重要。

## 6. 后台任务与 Worker

### 6.1 MVP 推荐方案

MVP 不引入 Redis、BullMQ、Temporal、n8n。

推荐：

```text
SQLite jobs table
+ p-queue
+ Worker loop
```

用途：

- Inbox 扫描任务。
- AI Proposal 生成任务。
- 按需 Patch 生成任务。
- Apply 任务。
- Rollback 任务。

理由：

- 本地单用户场景不需要 Redis。
- SQLite job 表可以记录任务状态，支持失败重试和崩溃恢复。
- `p-queue` 足够控制并发。

### 6.2 后续升级

如果出现多用户、云端、分布式执行，再考虑：

```text
BullMQ + Redis
Temporal
```

MVP 不引入。

## 7. AI 配置与 Provider

### 7.1 参考 next-ai-draw-io

`next-ai-draw-io` 的 AI 配置模式值得参考：

```text
Vercel AI SDK 多 Provider
+ 环境变量
+ ai-models.json
+ Admin Panel
+ Provider test endpoint
+ Zod schema
```

但 PKWS MVP 应该简化。

### 7.2 MVP 推荐方案

推荐：

```text
ai / Vercel AI SDK
@ai-sdk/openai
OpenAI-compatible base URL
Zod structured output validation
```

MVP 配置项：

```text
Provider
Base URL
API Key
Default Model
Max Tokens
Test Model
```

MVP 不做：

- 多任务模型映射。
- 多 Provider 复杂策略。
- quota。
- Langfuse / tracing。
- Bedrock / Vertex 深度配置。
- 自动 Apply 策略。

### 7.3 与 superpowers@openai-api-curated 的关系

`superpowers@openai-api-curated` 可作为开发辅助，用于查询 OpenAI API、模型、结构化输出和最佳实践。

它不应成为 PKWS 运行时领域依赖。

运行时仍保持：

```text
Case Engine
  -> AI Gateway
  -> Vercel AI SDK / OpenAI-compatible Provider
```

### 7.4 后续扩展

后续可以增加：

- Anthropic。
- Google Gemini。
- OpenRouter。
- Ollama。
- AI Gateway。
- 多模型任务映射。

但领域层不能绑定具体 Provider。

## 8. 本地存储

### 8.1 SQLite

选择：推荐采用。

推荐组合：

```text
better-sqlite3
Drizzle ORM
```

用途：

- Case。
- Timeline Event。
- Knowledge Anchor。
- Artifact。
- Proposal。
- Patch Intent。
- Patch Manifest。
- Apply Manifest。
- Settings metadata。
- Job queue。

理由：

- 单用户本地应用非常适合 SQLite。
- `better-sqlite3` 简单直接。
- Drizzle 比 Prisma 更轻，更适合本地嵌入式场景。

注意：

- Workspace 数据不放进 Obsidian Vault。
- 需要迁移机制。
- 需要备份 SQLite 文件。

### 8.2 Workspace 目录结构

MVP 不需要拆成多个独立存储系统。

推荐：

```text
.pkws-workspace/
  db/
    pkws.sqlite
  backups/
    case_xxx/
  staging/              # optional，只用于生成内容 Patch 的预览草稿
    case_xxx/
  logs/
  config/
```

说明：

- `db/` 是系统事实来源。
- `backups/` 保存 Apply 前快照。
- `staging/` 不是默认处理空间，只在生成正式笔记、摘要追加等内容 Patch 时使用。
- Workspace 不放在 Obsidian Vault 内。

## 9. 文件监听与 Vault 操作

### 9.1 文件监听

推荐：

```text
chokidar
```

用途：

- 监听 Clipper Inbox 目录。
- 发现新 Markdown。
- 触发扫描任务。

注意：

- 文件写入稳定后再读取。
- 支持手动刷新扫描。
- Watcher 失败要在 UI 中可见。

### 9.2 安全文件写入

推荐：

```text
fs-extra
write-file-atomic
proper-lockfile
node:crypto
```

用途：

- 创建目录。
- 复制备份。
- 原子写入。
- 文件锁。
- hash 校验。

注意：

- 所有 Vault 写入必须走 Vault Safety Layer。
- `pkws_id` 写入是唯一默认 Vault 修改。
- 其他修改必须来自用户批准的 Patch Manifest。
- Apply 前必须备份受影响文件。
- 回滚前必须检测目标文件是否被用户手动修改。

## 10. Markdown 与 Frontmatter

### 10.1 Frontmatter

推荐：

```text
gray-matter
yaml
```

用途：

- 读取 `pkws_id`。
- 写入最小 `pkws_id`。
- 读取 Clipper 元信息。

注意：

- 写入时尽量保留用户已有字段。
- 默认不写 `case_id`。
- 默认不写 `pkws_status`。
- 不把 Case 列表、Proposal、Patch、Timeline 写入笔记。

### 10.2 Markdown AST

推荐：

```text
unified
remark-parse
remark-gfm
unist-util-visit
```

用途：

- 标题结构分析。
- 链接提取。
- 批注锚点上下文。
- 后续 Obsidian wikilink / callout 扩展。

MVP 可以先轻量使用，不要过早构建完整 Markdown 编辑器。

## 11. Patch Preview 与 Diff

### 11.1 Proposal 不是 Patch

AI 默认输出 Proposal。

Proposal 只表达建议、理由、风险和可选动作，不包含可执行文件操作。

Patch 只有在用户选择 Move、Enrich、Generate Formal Note 等动作后才生成。

### 11.2 Patch Manifest

执行层必须使用结构化 Patch Manifest。

MVP 支持白名单：

```text
create_file
update_file
move_file
```

MVP 禁止：

```text
delete_file
bulk_update
cross_vault_move
complex_merge
```

### 11.3 Diff 展示

推荐：

```text
jsdiff
react-diff-view
```

用途：

- 展示 Markdown 预览。
- 展示新增/修改差异。

注意：

- Diff 只用于展示。
- 真正执行必须依赖结构化 Patch Manifest。

## 12. Obsidian 集成

### 12.1 MVP

MVP 不实现完整 Obsidian 插件。

采用：

```text
Obsidian Web Clipper
+ 文件系统监听
+ pkws_id frontmatter
+ Web Console 跳转到笔记路径
```

### 12.2 Phase 2

后续再实现轻量 Obsidian Companion Plugin。

可参考：

```text
Obsidian 官方 Plugin API
Obsidian sample plugin
```

插件只做：

- 状态卡。
- 快捷批注。
- 选择 Case。
- 打开 Web Console。

不做完整看板。

## 13. 暂缓或不采用

### 13.1 Electron

暂缓。

理由：

- MVP 先验证工作流价值。
- Electron 会增加打包、权限、更新、密钥管理复杂度。

参考项目：

- `E:/code/snorkeling`
- `next-ai-draw-io` Electron 构建脚本

### 13.2 Next.js

暂不采用。

理由：

- PKWS MVP 是本地控制台，不需要 SSR。
- Vite 更轻。
- 后端 API 用 Fastify 更直接。

### 13.3 Redis / BullMQ

暂不采用。

理由：

- 本地单用户不应引入 Redis。
- SQLite job 表 + p-queue 足够。

### 13.4 Prisma

暂不优先。

理由：

- 本地嵌入式场景偏重。
- Drizzle 更轻。

### 13.5 向量数据库

暂不采用。

理由：

- MVP 核心不是语义搜索。
- 当前核心是 Case、Proposal、Patch、Approval、Apply。

## 14. 与参考项目的关系

### 14.1 next-ai-draw-io

可参考：

- Vercel AI SDK 多 Provider 封装。
- AI Provider 配置页面。
- Admin settings API。
- Test Model endpoint。
- Secret mask / merge 逻辑。

不照搬：

- 复杂 Provider 全量支持。
- quota。
- Langfuse。
- Bedrock / Vertex 深度参数。
- Next.js 架构。

### 14.2 snorkeling

可参考：

- Electron + Vite + React 工程结构。
- 本地后台服务组织。
- SQLite migration。
- jobmanager / eventbus。
- secretstore。
- filebackup / filestore。

MVP 不照搬：

- Go + TypeScript 双栈。
- 完整 Electron 桌面壳。
- 终端相关复杂能力。

## 15. MVP 推荐技术栈清单

第一阶段建议：

```text
Frontend:
  Vite
  React
  TypeScript
  TailwindCSS
  Radix UI / shadcn/ui
  React Router
  TanStack Query

Backend:
  Node.js
  TypeScript
  Fastify
  Zod

AI:
  ai / Vercel AI SDK
  @ai-sdk/openai
  OpenAI-compatible endpoint

Storage:
  SQLite
  better-sqlite3
  Drizzle ORM

Worker:
  SQLite jobs table
  p-queue

Vault / Files:
  chokidar
  fs-extra
  write-file-atomic
  proper-lockfile
  node:crypto

Markdown:
  gray-matter
  yaml
  unified
  remark-parse
  remark-gfm

Diff:
  jsdiff
  react-diff-view

Deferred:
  Electron
  Obsidian Companion Plugin
  Browser Companion Plugin
  Redis / BullMQ
  Vector DB
```

## 16. 已收口决策

1. 第一版只支持单 Vault、单 Inbox。
2. 第一版只需要 OpenAI-compatible Provider。
3. 第一版只允许 `create_file`、`update_file`、`move_file` 三类 Patch。
4. `pkws_id` 默认由 PKWS 补写；可提供推荐 Clipper 模板预留字段。
5. API Key 第一版优先本地配置，后续再接系统密钥库。
6. SQLite job 表第一版需要支持状态、失败原因、重试次数和幂等键。

## 17. 资料来源

- Vite: https://vite.dev/guide/
- TypeScript: https://www.typescriptlang.org/docs/
- TailwindCSS with Vite: https://tailwindcss.com/docs/installation/using-vite
- Vercel AI SDK: https://ai-sdk.dev/docs
- Fastify: https://fastify.dev/docs/latest/
- Drizzle ORM: https://orm.drizzle.team/docs/overview
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
- Chokidar: https://github.com/paulmillr/chokidar
- Zod: https://zod.dev/
- Electron: https://www.electronjs.org/docs/latest/
- next-ai-draw-io: https://github.com/DayuanJiang/next-ai-draw-io
- snorkeling: E:/code/snorkeling
