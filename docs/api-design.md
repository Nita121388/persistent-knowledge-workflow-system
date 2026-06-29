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
- 明确区分 Proposal、Patch Intent、Patch Manifest、Apply。
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
- 大文件 Patch Apply。
- Rollback 具体执行。
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
status?: Captured | Analyzing | ReviewRequired | PatchPreview | Applying | Done | Dropped | Error | RolledBack
queue?: inbox | review | active | closed
q?: string
limit?: number
offset?: number
```

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
currentPatch
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
- 不自动生成 Patch。

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
- 不生成 Patch。

### GET /cases/:caseId/proposals

用途：查看 Case 的历史 Proposal。

## 9. Patch Intent API

### POST /cases/:caseId/patch-intents

用途：用户选择具体动作，请求系统生成 Patch。

请求示例：Move：

```json
{
  "action": "move",
  "targetPath": "项目/2026/Q3/设计素材/AI 绘画工具汇总.md",
  "instruction": "移动到设计素材目录，不改正文。"
}
```

请求示例：Generate Formal Note：

```json
{
  "action": "generate_formal_note",
  "targetPath": "资源库/AI工具/AI 绘画工具汇总.md",
  "instruction": "基于原文生成一篇正式整理笔记，保留来源链接。"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "patchIntentId": "pi_20260627_001",
    "jobId": "job_20260627_003"
  }
}
```

行为：

- 创建 Patch Intent。
- 创建 `generate_patch` Job。
- 不直接 Apply。

### GET /cases/:caseId/patch-intents

用途：查看某个 Case 下的 Patch Intent 历史。

## 10. Patch API

### GET /cases/:caseId/patches/:patchId

用途：获取 Patch Manifest 与 Preview。

返回：

```json
{
  "id": "patch_20260627_001",
  "status": "preview",
  "operations": [
    {
      "type": "move_file",
      "fromPath": "Inbox/Web Clips/AI 绘画工具汇总.md",
      "toPath": "项目/2026/Q3/设计素材/AI 绘画工具汇总.md"
    }
  ],
  "preview": {
    "affectedFiles": [
      "Inbox/Web Clips/AI 绘画工具汇总.md",
      "项目/2026/Q3/设计素材/AI 绘画工具汇总.md"
    ]
  }
}
```

### POST /cases/:caseId/patches/:patchId/reject

用途：拒绝当前 Patch。

请求：

```json
{
  "reason": "目标目录不对"
}
```

行为：

- Patch 状态变为 `rejected`。
- Case 回到 `ReviewRequired` 或 `NeedDiscussion`。

## 11. Apply API

### POST /cases/:caseId/patches/:patchId/approve-apply

用途：用户批准并执行 Patch。

请求：

```json
{
  "approvalNote": "确认移动到该目录"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "jobId": "job_20260627_004"
  }
}
```

行为：

- Patch 状态变为 `approved`。
- 创建 `apply_patch` Job。
- Worker 通过 Vault Safety Layer 执行。
- Apply 前创建备份和 Apply Manifest。

约束：

- 不能 Apply 非当前 Case 的 Patch。
- 不能 Apply 未处于 `preview` 状态的 Patch。
- 不能跳过 hash 校验。

## 12. Rollback API

### POST /cases/:caseId/rollback

用途：回滚该 Case 最近一次 Apply。

请求：

```json
{
  "applyManifestId": "apply_20260627_001",
  "reason": "移动位置不合适"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "jobId": "job_20260627_005"
  }
}
```

行为：

- 创建 `rollback_apply` Job。
- Rollback 前检查目标文件是否被用户手动修改。
- 冲突时返回 `ROLLBACK_BLOCKED`，不强行覆盖。

## 13. Workspace Rules API

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

## 14. Job API

### GET /jobs/:jobId

用途：查询异步任务状态。

响应：

```json
{
  "id": "job_20260627_004",
  "type": "apply_patch",
  "status": "running",
  "retryCount": 0,
  "errorMessage": null,
  "createdAt": "2026-06-27T10:30:00.000Z"
}
```

### GET /jobs

用途：调试和后台任务列表。

MVP 可仅在 Settings / Diagnostics 页面使用。

## 15. Anchor API

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

## 16. 未来 Obsidian 插件预留 API

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

## 17. API 开发顺序

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
POST /cases/:caseId/proposals/regenerate
POST /cases/:caseId/comment
POST /cases/:caseId/mark-done
POST /cases/:caseId/drop
POST /cases/:caseId/patch-intents
GET /cases/:caseId/patches/:patchId
POST /cases/:caseId/patches/:patchId/approve-apply
POST /cases/:caseId/rollback
```

## 18. 不做的 API

MVP 不提供：

- 删除 Vault 文件 API。
- 批量重构 API。
- 跨 Vault 移动 API。
- 云端同步 API。
- 多用户权限 API。
- 向量搜索 API。
- Chat API。
