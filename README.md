# Persistent Knowledge Workflow System

> 持续知识工作流系统，把网页收藏推进为可追踪、可审批、可回滚、可闭环的知识 Case。

## 项目定位

本项目不是新的聊天产品，也不是替代 Obsidian 的 PKM 工具，而是围绕 Obsidian Web Clipper 和 Obsidian Vault 构建的知识工作流系统。

核心目标：

- 让每一次网页收藏都有明确结局：Done、Drop 或 Archive。
- 让 AI 负责分析与提案，让用户保留最终决策权。
- 让所有系统造成的 Vault 修改都可预览、可审计、可回滚。
- 长期兼容并跟进 Obsidian Web Clipper，不重复建设网页剪藏能力。
- MVP 阶段保持简单，优先复用成熟 Node 生态与开源模块。

## 当前阶段

当前处于产品需求、架构设计、模块设计和交互设计阶段。

MVP 产品组件初步确定为：

- Obsidian Web Clipper：浏览器侧网页收藏入口。
- PKWS Web Console：Case 列表、AI 提案、按需 Patch 预览、审批、回滚和设置界面。
- PKWS Local Backend API：本地后端协调层。
- PKWS Background Worker：异步执行 Inbox 扫描、AI Proposal、按需 Patch、Apply 和 Rollback。
- PKWS File Watcher：监听 Obsidian Vault Inbox 中的新收藏笔记。
- PKWS AI Gateway：AI Provider、Model、Key 和安全策略配置入口。
- Workspace / Backup / Optional Staging Storage：系统数据、回滚快照和按需内容预览存储。
- Vault Safety Layer：系统写入 Obsidian Vault 的唯一安全通道。

已创建文档：

- `docs/requirements.md`：MVP 需求描述与边界
- `docs/use-cases.md`：典型使用案例与产品行为约束
- `docs/architecture.md`：总体架构设计
- `docs/modules.md`：核心模块设计
- `docs/interaction-design.md`：交互设计
- `docs/memory-design.md`：记忆设计
- `docs/tech-stack.md`：MVP 技术栈选型
- `docs/development-plan.md`：MVP 开发计划
- `docs/data-model.md`：MVP 数据模型设计
- `docs/api-design.md`：MVP API 设计
- `docs/proposal-patch-boundary.md`：Proposal 与 Patch 边界设计
- `docs/vault-safety.md`：Vault 安全写入与回滚设计

下一步计划：

1. 项目脚手架
2. Settings 与 AI 配置
3. Inbox 扫描与 `pkws_id` 写入
4. Case Dashboard 与 AI Proposal
5. 按需 Patch Preview、Approve & Apply、Rollback
6. 真实网页收藏试跑

## MVP 一句话

基于 Obsidian Web Clipper 的本地优先知识工作流系统：Clipper 原始笔记直接落地 Vault 并由 `pkws_id` 受管，AI 默认只生成整理 Proposal，用户选择具体动作后才生成 Patch，批准后再由 Vault Safety Layer 安全写入并支持回滚。
