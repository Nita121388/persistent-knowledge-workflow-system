# 用户多触点交互职责图

> 对应文档：`docs/interaction-design.md`、`docs/architecture.md`
> 说明：三个用户可感知的界面各自负责什么，避免用户混淆"该去哪里操作"

## 核心分工

```
              ┌─────────────────────────────────────┐
              │          用户的一天                   │
              │                                      │
              │  • 浏览器 → 发现内容、收藏             │
              │  • Web Console → 决策、审批、配置       │
              │  • Obsidian → 阅读、编辑、批注          │
              └─────────────────────────────────────┘
```

---

### 详细职责流程

```mermaid
flowchart LR
    subgraph Browser[浏览器]
        direction TB
        B1[📖 阅读网页]
        B2[🔖 Obsidian Web Clipper<br/>收藏到 Vault Inbox]
        B3[✏️ 可选：添加收藏批注]

        B1 --> B2
        B2 -.-> B3
    end

    subgraph Console[Web Console • 决策台]
        direction TB
        C1[📋 Dashboard<br/>Inbox / Review / Active / Closed]
        C2[📄 Case Detail<br/>Proposal / Patch / Timeline]
        C3[⚙️ Settings<br/>AI / Vault / Rules / Agent]

        C1 -->|点击 Case| C2
        C1 -->|齿轮图标| C3
    end

    subgraph Obsidian[Obsidian • 内容工作区]
        direction TB
        O1[📝 阅读收藏笔记]
        O2[✏️ 手动编辑内容]
        O3[💬 Phase 2：选中文本<br/>追加批注到 Case]
        O4[🔗 Phase 2：跳转<br/>Web Console 对应 Case]

        O1 --> O2
        O2 -.-> O3
        O3 --> O4
    end

    subgraph System[系统后台]
        S1[⚙️ File Watcher<br/>发现新笔记]
        S2[🤖 AI Worker<br/>分析 + Proposal + Patch]
        S3[🔒 Vault Safety Layer<br/>备份 + 校验 + 写入]

        S1 --> S2 --> S3
    end

    Browser -->|笔记落地 Vault| System
    System -->|创建 Case| Console
    Console -->|Approve & Apply| System
    System -->|安全写入| Obsidian
    Console -->|🔗 跳转| Obsidian
    Obsidian -.->|Phase 2: 批注| System
```

---

### 用户决策表

| 你要做什么 | 去哪里 | 入口 |
|-----------|--------|------|
| 收藏网页 | 浏览器 | Obsidian Web Clipper 扩展 |
| 查看有哪些未完成的 Case | Web Console | Dashboard |
| 看 AI 对这个收藏为什么建议这样处理 | Web Console | Case Detail → Proposal |
| 预览 Patch 会修改哪些文件 | Web Console | Case Detail → Patch Preview |
| 审批 / 拒绝 / 追加指示 | Web Console | Case Detail → 操作按钮 |
| 回滚一次系统写入 | Web Console | Case Detail → Rollback |
| 配置 AI Provider / Vault 路径 / 规则 | Web Console | Settings |
| 阅读整理后的笔记内容 | Obsidian | Vault 中对应文件 |
| 手动编辑笔记 | Obsidian | 直接在 Obsidian 中修改 |
| 选中文本追加批注（Phase 2） | Obsidian | 插件快捷键 |
| 查看轻量 Case 状态（Phase 2） | Obsidian | 插件状态卡 |

### 设计红线

```
❌ 不要在 Obsidian 中做完整审批
❌ 不要在浏览器中管理 Case
❌ 不要把 Proposal / Timeline 写入正文
❌ 不要把 Case 关系写进笔记 Frontmatter（只写 pkws_id）
```
