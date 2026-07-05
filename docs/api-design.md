# 持续知识工作流系统 API 设计

> 版本：v0.1
> 状态：API 草案
> 阶段：MVP 设计
> 更新日期：2026-06-27

## 1. 设计目标

API 负责连接 Web Console、Background Worker 和未来的 Obsidian / Browser Companion。

MVP API 设计目标：

- 支撑本地 Web Console 完成主要工作流。
- 所有长任务通过 Job 异步执行。
- 明确区分 Proposal（AI 建议） ↔ invoke-next（用户批准下一步动作） ↔ AI 直接写真 vault 三个阶段。
- 禁止前端直接操作 Vault 文件系统。
- 为未来轻量 Obsidian 插件预留批注和 Case 查询接口。

## 2. API 分层

```text
Web Console
  -> Local Backend API
  -> Workspace Store / Job Queue
  -> Worker
  -> Vault Safety Layer / AI Gateway
```

API Service 只负责：

- 参数校验。
- 权限和路径边界校验。
- 读写 Workspace。
- 创建 Job。
- 返回当前状态。

API Service 不负责：

- 长时间 AI 调用。
- 直接写真 vault（由 Agent Runtime 在用户批准 `modify_vault` 动作后做，回滚交给 Obsidian 原生版本历史）。
- 直接让前端写 Vault。

## 3. 通用约定

### 3.1 Base URL

```text
http://localhost:{port}/api
```

### 3.2 响应格式

成功：

```json
{
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Vault path is required",
    "details": {}
  }
}
```

### 3.3 错误码

```text
VALIDATION_ERROR
NOT_FOUND
CONFLICT
JOB_FAILED
AI_ERROR
VAULT_PATH_FORBIDDEN
VAULT_HASH_CHANGED
PATCH_NOT_APPROVED
ROLLBACK_BLOCKED
INTERNAL_ERROR
```

### 3.4 时间格式

所有时间使用 ISO 8601 字符串。

```text
2026-06-27T10:30:00.000Z
```

## 4. Health

### GET /health

用途：检查后端是否运行。

响应：

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "version": "0.1.0"
  }
}
```

## 5. Settings API

### GET /settings

用途：读取本地配置。

返回字段：

```text
vaultPath
inboxPath
workspacePath
aiProvider
aiBaseUrl
aiDefaultModel
autoAnalyze
```

注意：

- 不返回明文 API Key。
- 只返回 `apiKeyConfigured: boolean`。

### PUT /settings

用途：保存配置。

请求：

```json
{
  "vaultPath": "E:/File/NitaFile/Obsidians/Obsidian",
  "inboxPath": "E:/File/NitaFile/Obsidians/Obsidian/Inbox/Web Clips",
  "workspacePath": "E:/code/pkws-workspace",
  "aiProvider": "openai-compatible",
  "aiBaseUrl": "https://api.openai.com/v1",
  "aiApiKey": "sk-...",
  "aiDefaultModel": "gpt-4.1-mini",
  "autoAnalyze": true
}
```

约束：

- `vaultPath` 必须存在。
- `inboxPath` 必须在 `vaultPath` 内。
- `workspacePath` 不应在 `vaultPath` 内。

### POST /settings/test-model

用途：测试 AI Provider 是否可用。

请求：

```json
{
  "aiProvider": "openai-compatible",
  "aiBaseUrl": "https://api.openai.com/v1",
  "aiApiKey": "sk-...",
  "aiDefaultModel": "gpt-4.1-mini"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "model": "gpt-4.1-mini",
    "latencyMs": 1200
  }
}
```

## 6. Inbox API

### POST /inbox/scan

用途：手动扫描 Inbox，发现 Clipper 笔记。

请求：

```json
{
  "mode": "incremental"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "jobId": "job_20260627_001"
  }
}
```

说明：

- 扫描是异步 Job。
- 同一文件重复扫描必须幂等。
- 缺少 `pkws_id` 的笔记会触发写入最小锚点。

## 7. Case API

### GET /cases

用途：获取 Case 列表。

查询参数：

```text
status?: Captured | Analyzing | ReviewRequired | NeedDiscussion | Done | Dropped | Error
queue?: inbox | review | active | closed
q?: string
limit?: number
offset?: number
```

> 注：`PatchPreview` / `Approved` / `Applying` / `RolledBack` 是已退役的旧补丁编排状态。Case 现在通过 `ReviewRequired`/`NeedDiscussion` 在 Proposal ↔ AI 之间循环，AI 通过 `invoke-next` 拿到用户批准的 `modify_vault` 动作后直接写真 vault。

响应数据项：

```json
{
  "id": "case_20260627_001",
  "title": "AI 绘画工具汇总",
  "status": "ReviewRequired",
  "anchorId": "kw_20260627_x7f3a",
  "sourceUrl": "https://example.com",
  "currentVaultPath": "Inbox/Web Clips/AI 绘画工具汇总.md",
  "updatedAt": "2026-06-27T10:30:00.000Z"
}
```

### GET /cases/:caseId

用途：获取 Case 详情。

返回：

```text
case
anchor
artifact
currentProposal
instructionSummary
timeline
jobs
```

### POST /cases/:caseId/comment

用途：用户补充指示，让 AI 重新理解 Case。

请求：

```json
{
  "comment": "这个不要放到 AI 工具目录，放到项目/2026/Q3/设计素材，并提取网址。",
  "updateInstructionSummary": true
}
```

行为：

- 创建 `user_commented` Timeline Event。
- 可更新 Case Instruction Summary。
- 创建 `generate_proposal` Job。
- Case 进入 `Analyzing` 或 `NeedDiscussion`。

### POST /cases/:caseId/mark-done

用途：用户确认当前笔记无需进一步修改，Case 完成。

请求：

```json
{
  "note": "原始收藏已经足够，暂不整理。"
}
```

行为：

- 不修改 Vault。
- Case 进入 `Done`。
- 创建 `user_marked_done` Timeline Event。

### POST /cases/:caseId/drop

用途：用户放弃处理该收藏。

请求：

```json
{
  "reason": "低价值内容"
}
```

行为：

- 不删除 Vault 原始笔记。
- Case 进入 `Dropped`。
- 创建 `user_dropped` Timeline Event。

### POST /cases/:caseId/reopen

用途：重新打开 Done / Dropped Case。

请求：

```json
{
  "reason": "半年后需要重新整理"
}
```

行为：

- Case 回到 `ReviewRequired` 或 `NeedDiscussion`。
- 不直接改 vault；用户在 Proposal 上选某个 `proposedNextAction`，触发 `invoke-next` 后由下一轮 AI 改。

## 8. Proposal API

### POST /cases/:caseId/proposals/regenerate

用途：重新生成 AI Proposal。

请求：

```json
{
  "reason": "用户补充了新的整理偏好"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "jobId": "job_20260627_002"
  }
}
```

行为：

- 创建 `generate_proposal` Job。
- 成功后保存新的 Proposal。
- AI 不直接写真 vault；只会通过 `proposedNextActions` 提议 `modify_vault` 类动作，由用户批准后下一轮 AI 才写。

### GET /cases/:caseId/proposals

用途：查看 Case 的历史 Proposal。

## 9. （已退役）Patch / Apply / Rollback API

> **这一节整体退役（line 1）。** 历史上的 `POST /cases/:caseId/patch-intents`、`GET /cases/:caseId/patches/:patchId`、`POST /cases/:caseId/patches/:patchId/reject`、`POST /cases/:caseId/patches/:patchId/approve-apply`、`POST /cases/:caseId/rollback` 这些路由、以及背后的 `patch_intents` / `patch_manifests` / `apply_manifests` 表，已经全部删除。
>
> 现在的流程是「放权给 AI」：
>
> 1. AI 在每一轮把建议写进 Proposal 的 `proposedNextActions[]`，前端把这些动作渲染成动态按钮（不再生成 Patch Manifest / Preview / diff）。
> 2. 用户点某个按钮 → `POST /cases/:caseId/invoke-next`（见第 8 节），后端把选中动作的 `intent` / `sideEffect` / `payload` 回灌给下一轮 AI。
> 3. 当 `sideEffect === 'modify_vault'` 时，下一轮 AI 直接通过 Agent Runtime 把 `patch-operations.json` 应用到真 vault（`@pkws/vault` 的 `applyOperations`），并在 `timeline_events` 写一条 `vault_modified` 事件。
> 4. 回滚交给 Obsidian 原生版本历史 / 文件备份；系统不再维护 `apply_manifests`、`rollback_apply` Job。

## 10. Workspace Rules API

### GET /workspace-rules

用途：读取全局规则。

### POST /workspace-rules

用途：新增规则。

请求：

```json
{
  "title": "Prompt 内容默认放 Agent 目录",
  "content": "涉及 Prompt、Agent、Workflow 的资料默认建议放到 Agent/ 目录。",
  "enabled": true,
  "priority": 100
}
```

### PUT /workspace-rules/:ruleId

用途：修改规则。

### DELETE /workspace-rules/:ruleId

用途：禁用或删除规则。

MVP 可以先实现软删除或 `enabled=false`。

## 11. Job API

### GET /jobs/:jobId

用途：查询异步任务状态。

响应：

```json
{
  "id": "job_20260627_004",
  "type": "generate_proposal",
  "status": "running",
  "retryCount": 0,
  "errorMessage": null,
  "createdAt": "2026-06-27T10:30:00.000Z"
}
```

### GET /jobs

用途：调试和后台任务列表。

MVP 可仅在 Settings / Diagnostics 页面使用。

## 12. Anchor API

### GET /anchors/:anchorId

用途：通过 `pkws_id` 查询关联内容。

返回：

```text
anchor
artifacts
cases
latestTimelineEvents
```

未来 Obsidian Companion 可以用这个接口在笔记内展示状态卡。

### POST /anchors/:anchorId/relink

用途：用户手动重新绑定路径。

请求：

```json
{
  "newVaultPath": "项目/2026/Q3/设计素材/AI 绘画工具汇总.md"
}
```

行为：

- 更新 Anchor 当前路径。
- 记录 Timeline Event。
- 不自动移动文件。

## 13. 未来 Obsidian 插件预留 API

MVP 不实现插件，但预留接口形态：

```text
GET  /anchors/by-path?path=...
GET  /anchors/:anchorId
POST /anchors/:anchorId/comments
POST /cases
```

用于支持：

- 在 Obsidian 打开的笔记中查询关联 Case。
- 用户选中文本后补充批注。
- 用户从 Obsidian 快捷键创建新 Case。
- 用户选择把批注绑定到已有 Case 或创建新 Case。

## 14. API 开发顺序

建议顺序：

```text
GET /health
GET /settings
PUT /settings
POST /settings/test-model
POST /inbox/scan
GET /jobs/:jobId
GET /cases
GET /cases/:caseId
POST /cases/:caseId/invoke-next      # 选中某个 proposedNextAction，触发下一轮 AI
POST /cases/:caseId/comment          # 用户反馈，触发 regenerate
POST /cases/:caseId/mark-done
POST /cases/:caseId/drop
GET /workspace-rules
POST /workspace-rules
GET /anchors
```

## 15. 不做的 API

MVP 不提供：

- 删除 Vault 文件 API。
- 批量重构 API。
- 跨 Vault 移动 API。
- 云端同步 API。
- 多用户权限 API。
- 向量搜索 API。
- Chat API。
