# Agent Runtime 多 Case 调度架构图

> 对应文档：`docs/agent/agent-runtime.md` §3 架构设计
> 生成日期：2026-07-02

```mermaid
flowchart TB
    subgraph Trigger[触发来源]
        U1[用户评论 / 新Case创建]
        U2[Scheduler定时轮询]
    end

    subgraph Runtime[Agent Runtime 常驻进程]
        direction TB

        subgraph Scheduler[调度器 Scheduler Loop]
            direction LR
            PQ[(优先级队列)]
            WQ[(等待队列)]

            PQ --> |1. hasNewInput===true| C1[Case_001<br/>awaiting=false]
            WQ --> |2. awaiting===false| C3[Case_003<br/>hasNewInput=false]
            PQ --> |3. FIFO| Cn[Case_N<br/>等待最久]
            WQ --> |4. 全部await→空转| Idle[空转 5s 轮询]
        end

        subgraph Decide[decideAction 决策]
            direction TB
            D{{检查 session 状态}}
            D --> |turnCount === 0| NT[NewTurn<br/>从SQLite重建]
            D --> |totalTokens < 阈值| CT[Continue<br/>追加消息直接调 LLM]
            D --> |totalTokens > 阈值| CMP[CompressThenContinue<br/>折叠旧 + 保留最近 N 条]
        end

        subgraph SessionPool[activeCases: Map&lt;caseId, CaseSession&gt;]
            S1[case_001<br/>messages: 5条<br/>tokens: ~8k<br/>hasNewInput: true]
            S2[case_003<br/>messages: 12条<br/>tokens: ~24k<br/>awaiting: true]
            S3[case_007<br/>messages: 2条<br/>tokens: ~3k]
            SN[case_N …<br/>maxActiveSessions: 20]
        end

        subgraph Exec[执行层 CLI Runner]
            CB[1. 构建CLAUDE.md<br/>Case目标+Rules+历史]
            SP[2. spawn CLI子进程<br/>--print 模式]
            OP[3. 读取输出<br/>Zod校验]
            CB --> SP --> OP
        end

        subgraph Eviction[内存淘汰 LRU]
            EV{"超过 N 小时不活跃<br/>或超过 maxActiveSessions"}
            EV -->|是| PERSIST[序列化到SQLite<br/>释放内存]
            EV -->|否| KEEP[保留在内存]
        end

        Scheduler --> Decide
        Decide --> SessionPool
        SessionPool --> Exec
        Exec --> |输出结果追加messages| SessionPool
        SessionPool --- Eviction
    end

    subgraph Storage[持久化层 SQLite]
        DB[(agent_sessions 表)]
        DB2[(cases / timeline /<br/>proposals / patches)]
    end

    subgraph UI[Web UI]
        WS[WebSocket推送<br/>实时状态]
        DASH[Agent Dashboard<br/>会话列表+状态]
    end

    Trigger -->|onUserInput| Scheduler
    PERSIST --> DB
    DB -->|restoreSession| SessionPool
    Exec -->|写回 proposal/patch| DB2
    Runtime -->|WsEvent| WS
    WS --> DASH
```

## 图说明

| 编号 | 组件 | 职责 |
|------|------|------|
| 1 | **优先级队列** | `hasNewUserInput === true` 的 Case 优先调度 |
| 2 | **等待队列** | `awaitingUserInput === true` 的 Case 跳过，不给 LLM 调用 |
| 3 | **decideAction** | 根据 turnCount / totalTokens 选择 NewTurn / Continue / Compress |
| 4 | **CLI Runner** | 构建隔离工作目录 → spawn CLI → 读取输出 → Zod 校验 |
| 5 | **LRU Eviction** | 6 小时不活跃或超 maxActiveSessions 时持久化到 SQLite |
| 6 | **WebSocket** | 实时推送 turn_started / turn_completed / session_evicted 事件 |

## 调度优先级

```
1. hasNewUserInput === true     ← 用户刚评论了
2. awaitingUserInput === false  ← 不需要等用户
3. pendingQueue 中等待最久的   ← FIFO
4. 如果全部 awaitUserInput     → 空转，5s 轮询
```
