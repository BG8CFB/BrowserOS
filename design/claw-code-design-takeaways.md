# claw-code 可借鉴设计清单

> **文档用途**：在删除 `claw-code` 参考项目前，完整提取其源码中值得 BrowserOS 借鉴的设计点。每条都基于源码核查（含文件路径与行号），不依赖项目继续存在。
>
> **背景决策**：BrowserOS（TS + ai-sdk）从两个参考项目中选定 `claude-code` 为主参考（同语言、ai-sdk 兼容、模块可直接移植）；`claw-code`（Rust）作为辅助参考，只借鉴**设计思路**，不做代码级移植。
>
> **如何阅读**：每条设计点包含「claw-code 实现 / 解决的问题 / BrowserOS 现状 / 借鉴建议 / 适配难度」五段。P0/P1/P2 标记见末尾路线图。
>
> **核查基准日期**：2026-07-13。源码引用基于当时 `claw-code` 仓库 `main` 分支。

---

## 一、上下文压缩（7 项）

### 1.1 Trident 多管道压缩（P1）— 用户已认可

- **claw-code 实现**：[trident.rs:105-160](claw-code/rust/crates/runtime/src/trident.rs#L105-L160) `trident_compact_session` 把压缩拆成三阶段流水线：
  - **Stage 1 Supersede**（`stage1_supersede`，:179）— 扫描所有文件操作（Read/Write/Edit），若同一文件被后续 Write/Edit 覆盖，则把早期的 Read 视为 obsolete 直接删除（零成本事实裁剪）
  - **Stage 2 Collapse**（`stage2_collapse`，阈值 `collapse_threshold=4`）— 把连续 ≥4 条同类型消息折叠成单条摘要
  - **Stage 3 Cluster**（`stage3_cluster`，`cluster_min_size=3`、`cluster_similarity_threshold=0.6`）— 用相似度把 ≥3 条同类消息聚成一类
  - 三阶段后产物再喂给标准 `compact_session` 做 LLM 摘要
  - `TridentStats`（:32-57）含 `superseded_count / collapsed_chains / clusters_found / tokens_saved_estimate` 等统计
- **解决的问题**：纯 LLM 摘要成本高、信息损失随机；先用结构化管道裁掉"确定无价值"的消息（被覆盖的旧读取、重复操作），再让 LLM 处理剩余部分
- **BrowserOS 现状**：[compaction.ts](packages/browseros-agent/apps/server/src/agent/compaction.ts) 是 4 级瀑布（stripBinary → prune → reduceToolOutputs → LLM 摘要），**无结构化管道前筛**
- **借鉴建议**：在 [compaction/utils.ts](packages/browseros-agent/apps/server/src/agent/compaction/utils.ts) 增加 `tridentPreflight()`：
  - Stage 1 适配：扫描 `browser_navigate` 调用，若同一 URL 后被新导航覆盖，旧 snapshot 可清除
  - Stage 2 适配：连续 N 次 `browser_click` 同选择器可折叠
  - Stage 3 适配：相似 DOM snapshot 聚类
- **适配难度**：中。Supersede 阶段对浏览器 Agent 价值最大（导航历史易冗余），Collapse/Cluster 可后置

### 1.2 压缩后 Health Probe（P1）— 用户已认可

- **claw-code 实现**：[conversation.rs:308](claw-code/rust/crates/runtime/src/conversation.rs#L308) `run_session_health_probe` 在 compaction 完成后主动验证工具链是否仍可用，避免压缩引入"幽灵工具"
- **解决的问题**：压缩可能丢掉工具调用上下文（如某个 pageId 引用），下一轮调用才发现工具失效；探活让失败前置
- **BrowserOS 现状**：[compaction.ts](packages/browseros-agent/apps/server/src/agent/compaction.ts) 压缩后无任何探活，工具失效要等下一轮调用才暴露
- **借鉴建议**：在 [compaction.ts](packages/browseros-agent/apps/server/src/agent/compaction.ts) 的 `compactMessages` 完成后注入一个探活步：
  - 检查 `browserContext.pageId` 是否仍存在于 `BrowserManager`
  - 检查 `mcpServerKey` 引用的 MCP server 是否仍 connected
  - 失效时把状态写回 `AgentSession`，下一轮 `prepareStep` 自动重建
- **适配难度**：中。需要 BrowserManager 暴露 `isPageAlive(pageId)` 接口

### 1.3 压缩边界的 tool_use/tool_result 配对保护（P0）— **新发现，价值很高**

- **claw-code 实现**：[compact.rs:129-166](claw-code/rust/crates/runtime/src/compact.rs#L129-L166) `compact_session` 在确定保留窗口起点时，若发现"第一条保留消息是 ToolResult 但前一条 assistant 不含 ToolUse"，会**回退边界**直到 tool_use/tool_result 配对完整。注释明确写：避免 OpenAI-compat provider 报 400 `tool message must follow assistant with tool_calls`
- **解决的问题**：天真按消息数切分窗口，会把 tool_result 留下、tool_use 切走，导致 OpenAI/Gemini/Ollama 等 OpenAI-compat provider 直接拒绝请求
- **BrowserOS 现状**：[compaction/utils.ts:289](packages/browseros-agent/apps/server/src/agent/compaction/utils.ts#L289) 的 `findSafeSplitPoint` 是简单 user/assistant 边界查找，**没有 tool_use/tool_result 配对校验**
- **借鉴建议**：在 `findSafeSplitPoint` 后增加 `adjustSplitToPreserveToolPairs(messages, splitIndex)`：
  ```
  while messages[splitIndex].firstBlock is ToolResult
        and messages[splitIndex-1] has no ToolUse:
      splitIndex -= 1
  ```
- **适配难度**：低。30 分钟 + 单测覆盖

### 1.4 直接续写指令（Direct Resume Instruction）（P0）— **新发现**

- **claw-code 实现**：[compact.rs:3-6, 71-92](claw-code/rust/crates/runtime/src/compact.rs#L3-L6) 定义三个常量拼装压缩后续写消息：
  - `COMPACT_CONTINUATION_PREAMBLE` — "This session is being continued from a previous conversation..."
  - `COMPACT_RECENT_MESSAGES_NOTE` — "Recent messages are preserved verbatim."
  - `COMPACT_DIRECT_RESUME_INSTRUCTION` — "Continue the conversation from where it left off without asking the user any further questions. **Resume directly — do not acknowledge the summary, do not recap what was happening, and do not preface with continuation text.**"
- **解决的问题**：压缩后模型常见的反模式是"好的，根据总结我们刚才在做 X，现在继续..."——浪费 token、打断节奏、用户体感差
- **BrowserOS 现状**：[compaction/prompt.ts](packages/browseros-agent/apps/server/src/agent/compaction/prompt.ts) 的摘要 prompt 没有显式"禁止 recap"的指令
- **借鉴建议**：在 [compaction/prompt.ts](packages/browseros-agent/apps/server/src/agent/compaction/prompt.ts) 的 `buildSummarizationPrompt` 返回的摘要外层包一条 system 消息，明确写"直接续写、不要承认总结、不要回顾"
- **适配难度**：低。10 分钟，纯文案

### 1.5 多次压缩摘要合并（merge_compact_summaries）（P0）— **新发现**

- **claw-code 实现**：[compact.rs:170](claw-code/rust/crates/runtime/src/compact.rs#L170) `merge_compact_summaries(existing_summary.as_deref(), &summarize_messages(removed))` —— 二次压缩时不是覆盖旧摘要，而是合并；[compact.rs:106-110](claw-code/rust/crates/runtime/src/compact.rs#L106-L110) `extract_existing_compacted_summary` 先从 messages[0] 抽出已存在的摘要
- **解决的问题**：长会话经历多次压缩时，新摘要覆盖旧摘要会丢失最早的上下文；合并保留累积信息
- **BrowserOS 现状**：[compaction.ts](packages/browseros-agent/apps/server/src/agent/compaction.ts) 每次 `compactMessages` 都重新生成完整摘要，旧摘要被丢弃
- **借鉴建议**：在 [compaction.ts](packages/browseros-agent/apps/server/src/agent/compaction.ts) 的 `summarizeMessages` 接受 `existingSummary` 参数（已存在），摘要 prompt 中加入"已有摘要 + 新对话"两段输入，输出合并摘要
- **适配难度**：低。prompt 改造 + 一个参数

### 1.6 Grapheme-safe 截断（truncate_summary）（P0）

- **claw-code 实现**：[compact.rs:449-456](claw-code/rust/crates/runtime/src/compact.rs#L449-L456) `truncate_summary(content, max_chars)` 用 `chars().take(max_chars)` 按 Unicode scalar value 截断，末尾加 `…`（U+2026）而非 `...`
- **解决的问题**：按字节截断会切断 UTF-8 多字节字符（emoji、CJK）；按 UTF-16 code unit 截断会切断 surrogate pair
- **BrowserOS 现状**：通用做法 `text.slice(0, N)` 按 UTF-16 code unit 切，对 surrogate pair（如 👨‍👩‍👧）和 emoji 不安全
- **借鉴建议**：在 [packages/shared/src/](packages/browseros-agent/packages/shared/src/) 新建 `text-truncate.ts`，用 `Intl.Segmenter`（Node 16+）按 grapheme 切：
  ```ts
  export function truncateByGrapheme(text: string, max: number) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const graphs = [...seg.segment(text)].slice(0, max).map(s => s.segment).join('')
    return graphs.length < text.length ? graphs + '…' : graphs
  }
  ```
- **适配难度**：低。30 分钟 + 测试

### 1.7 Redact + Truncate 二级防护（P2）

- **claw-code 实现**：[session.rs:1143-1180](claw-code/rust/crates/runtime/src/session.rs) 维护 `MAX_JSONL_FIELD_CHARS=16KB`：**先 redact**（敏感字段如 API key、cookie 替换为 `[REDACTED]`）**再 truncate**（保留前 N KB + marker）
- **解决的问题**：用户输入可能包含 API key / cookie / OAuth token，会进会话上下文 / 上传到云端 Provider
- **BrowserOS 现状**：浏览器 Agent 处理 URL、表单、Cookie、OAuth——高敏感数据，但消息构造层无统一 redact
- **借鉴建议**：在 [apps/server/src/agent/message-normalization.ts](packages/browseros-agent/apps/server/src/agent/message-normalization.ts) 的 `normalizeMessagesForModel` 前加 `redactAndTruncate` pass：
  - 正则扫 `sk-[a-zA-Z0-9-_]{20,}` / `Bearer\s+[A-Za-z0-9._-]+` / `cookie:\s*[^;\s]+` / URL 中的 `?token=...` / `?access_token=...`
  - redact 后再按 16KB 截断
- **适配难度**：中。需谨慎避免 redact 误伤正常文本

---

## 二、会话持久化与多工作区（4 项）

### 2.1 workspace_fingerprint + SessionStore::from_cwd 分目录（P0）— 用户已认可

- **claw-code 实现**：
  - [session_control.rs:33-48](claw-code/rust/crates/runtime/src/session_control.rs#L33-L48) `SessionStore::from_cwd(cwd)` 先 `fs::canonicalize`（解析 symlink、相对路径、macOS `/tmp` vs `/private/tmp`），再用 `workspace_fingerprint(canonical_cwd)` 算 hex digest，目录布局 `<cwd>/.claw/sessions/<workspace_hash>/`。注释 #151 解释了 canonicalize 的必要性
  - [session_control.rs:55-72](claw-code/rust/crates/runtime/src/session_control.rs#L55-L72) `from_data_dir` 同样 canonicalize workspace_root
- **解决的问题**：同一项目用不同路径打开时不串会话；多 `opencode serve` 并行不冲突
- **BrowserOS 现状**：[session-store.ts:20](packages/browseros-agent/apps/server/src/agent/session-store.ts#L20) 是**纯内存 Map**，无持久化，无 workspace 隔离
- **借鉴建议**：在 [packages/shared/src/](packages/browseros-agent/packages/shared/src/) 新建 `workspace-id.ts`：
  ```ts
  export async function workspaceFingerprint(path: string): Promise<string> {
    const real = await fs.promises.realpath(path).catch(() => path)
    return crypto.createHash('sha256').update(real).digest('hex').slice(0, 16)
  }
  ```
  把 `SessionStore` 改造为 `WorkspaceSessionStore`，每个 workspace 一个 Map + 独立 JSONL 文件
- **适配难度**：低（fingerprint）/ 中（持久化改造）

### 2.2 SessionHeartbeat 四态健康检查（P1）— 用户已认可

- **claw-code 实现**：[session.rs:101](claw-code/rust/crates/runtime/src/session.rs#L101) `SessionHeartbeat` 四态：`Healthy / Stalled / TransportDead / Unknown`。`freshness_at` 把 heartbeat 时间戳映射成 freshness 状态
- **解决的问题**：长会话 + CDP 连接易断，需要活性检测区分"暂时停滞"vs"传输已死"
- **BrowserOS 现状**：[ai-sdk-agent.ts](packages/browseros-agent/apps/server/src/agent/ai-sdk-agent.ts) 的 session 无健康概念，CDP 断开要等下次工具调用才暴露
- **借鉴建议**：在 `AgentSession` 加 `heartbeat: SessionHeartbeat` 字段，由 ws ping / CDP `Target.targetHeartbeat` 自动更新；UI 显示状态
- **适配难度**：中。需要 ws 协议 + UI

### 2.3 JSONL Rotate（256KB + 3 files + 原子写）（P0）

- **claw-code 实现**：[session.rs:14-15, 1340-1418](claw-code/rust/crates/runtime/src/session.rs) 常量 `ROTATE_AFTER_BYTES = 256 * 1024`、`MAX_ROTATED_FILES = 3`：
  - `rotate_session_file_if_needed` — 写前检查文件大小，超过则 `rename(session.jsonl, session.rot-<ms>.jsonl)`
  - `cleanup_rotated_logs` — 按修改时间排序，删多余
  - `write_atomic` — 先写 `.tmp-<ms>-<counter>` 再 `rename`，保证崩溃时不损坏
- **解决的问题**：长会话 JSONL 无限增长；崩溃时半写坏文件无法恢复
- **BrowserOS 现状**：纯内存，无 JSONL；若引入持久化需要 rotate
- **借鉴建议**：在 [packages/shared/src/storage/](packages/browseros-agent/packages/shared/src/) 新建 `jsonl-store.ts`：
  ```ts
  export class JsonlRotatingStore {
    constructor(private dir: string, private rotateBytes = 256*1024, private maxRotated = 3) {}
    async append(record: unknown): Promise<void> { /* check size, rotate, atomic write */ }
    async listRotated(): Promise<string[]> { /* */ }
  }
  ```
- **适配难度**：低。约 100 行 TS + 测试

### 2.4 SessionFork + Parent 引用 + Branch Name（P1）

- **claw-code 实现**：[session.rs:71-75, 339-358](claw-code/rust/crates/runtime/src/session.rs) `SessionFork { parent_session_id, branch_name }`，`Session::fork(branch_name)` 复制 messages + compaction state，新 session_id 保留父引用。[session_control.rs:288-310](claw-code/rust/crates/runtime/src/session_control.rs#L288-L310) `fork_session` 落盘到独立路径
- **解决的问题**："我刚到这一步，想试试另一个方案不丢当前进度"——fork 出 branch_name 命名的子 session，原 session 仍可恢复
- **BrowserOS 现状**：会话线性追加，无 fork 概念
- **借鉴建议**：在 [session-store.ts](packages/browseros-agent/apps/server/src/agent/session-store.ts) 加 `fork(conversationId, branchName)`：
  - 复制当前 messages 到新 conversationId
  - metadata 写 `parentConversationId / branchName`
  - UI 加"复制会话为新分支"按钮
- **适配难度**：中。schema 改动 + UI

---

## 三、错误恢复（2 项）

### 3.1 RecoveryRecipe + Ledger + EscalationPolicy（P1）

- **claw-code 实现**：[recovery_recipes.rs](claw-code/rust/crates/runtime/src/recovery_recipes.rs)（941 行）：
  - :18-26 `FailureScenario` 枚举 7 类（TrustPromptUnresolved / PromptMisdelivery / StaleBranch / CompileRedCrossCrate / McpHandshakeFailure / PartialPluginStartup / ProviderFailure）
  - :77-86 `RecoveryStep` 枚举可执行步骤（AcceptTrustPrompt / RedirectPromptToAgent / RebaseBranch / CleanBuild / RetryMcpHandshake / RestartPlugin / RestartWorker / EscalateToHuman）
  - :91-95 `EscalationPolicy` 三选一（AlertHuman / LogAndContinue / Abort）
  - :101-106 `RecoveryRecipe { scenario, steps, max_attempts, escalation_policy }`
  - :155-169 `RecoveryLedgerEntry` 记录每场景的 attempt_count / retry_limit / state（Queued/Running/Succeeded/Failed/Exhausted）/ command_results
  - :142-151 `RecoveryEvent` 结构化事件（RecoveryAttempted / RecoverySucceeded / RecoveryFailed / Escalated）
- **解决的问题**：Provider/MCP/Plugin/Startup 等失败场景有统一的"先试一次自动恢复，再升级"流程，每次尝试留下结构化日志便于事后排查
- **BrowserOS 现状**：[ai-sdk-agent.ts](packages/browseros-agent/apps/server/src/agent/ai-sdk-agent.ts) 错误处理散在各处，无统一 RecoveryLedger / RecipeRegistry
- **借鉴建议**：在 [apps/server/src/agent/](packages/browseros-agent/apps/server/src/agent/) 新建 `recovery/`：
  - `recovery-recipes.ts` — 定义 `FailureScenario` enum（BrowserOS 化：`BrowserTabDisconnected / CdpTargetGone / McpHandshakeFailure / ProviderAuth / ScheduledJobSkipped / OAuthTokenExpired`）和 `RecipeRegistry`
  - `recovery-ledger.ts` — `RecoveryLedgerEntry` + `RecoveryContext`
  - 把现有 MCP/Provider/Schedule 错误处理改造成 `RecoveryStep`
- **适配难度**：中。3 天工作量

### 3.2 failureClass 错误归类（P0）

- **claw-code 实现**：[bash.rs:250-279](claw-code/rust/crates/runtime/src/bash.rs#L250-L279) `is_test_command()` 检测 `cargo test / npm test / pytest / yarn test / pnpm test` 等测试命令，超时后 `return_code_interpretation` 标 `"test.hung"`，`structured_content` 含 `failureClass: "test_hang"`，与普通超时区分
- **解决的问题**：LLM 看到一个超时无法判断"是真超时"还是"测试卡死要重写"；归类让模型做不同决策
- **BrowserOS 现状**：[tool-adapter.ts](packages/browseros-agent/apps/server/src/agent/tool-adapter.ts) 工具失败统一标 `isError: true`，无失败子类
- **借鉴建议**：在 tool output envelope 加 `failureClass?: string` 字段：
  - `network.timeout` vs `navigation.hang`
  - `selector.timeout` vs `page.hang`
  - `tab.disappeared` vs `cdp.detached`
  - `oauth.expired` vs `provider.429`
- **适配难度**：低。半天

---

## 四、沙箱与权限（5 项）

### 4.1 SandboxStatus 完整字段化 + fallback_reason（P1）

- **claw-code 实现**：[sandbox.rs:51-68](claw-code/rust/crates/runtime/src/sandbox.rs#L51-L68) `SandboxStatus` 不只是 `enabled: bool`，而是 13 字段：`enabled / requested / supported / active / namespace_supported / namespace_active / network_supported / network_active / filesystem_mode / filesystem_active / allowed_mounts / in_container / container_markers / fallback_reason`。清晰区分"请求了但不支持"vs"不支持所以降级"，`fallback_reason` 把降级原因聚合为可读字符串
- **解决的问题**：用户说"我开了沙箱"但实际未生效，需要明确告知"为什么没生效"
- **BrowserOS 现状**：浏览器本身就是最深的沙箱，但 Chromium 还有 `--site-per-process`、cookie partitioning、origin trial 等可选强化；用户不知道实际生效了什么
- **借鉴建议**：在 [apps/server/src/agent/](packages/browseros-agent/apps/server/src/agent/) 加 `BrowserHardeningStatus`：
  - 字段：`cdpIsolatedWorld / originTrialTokenEnabled / cookiePartitioningActive / sitePerProcessActive / thirdPartyCookiesBlocked`
  - 每个字段配 `requested vs active vs supported` 三态 + `fallbackReason`
  - 提供 `/status` 命令或 API 让用户查询
- **适配难度**：中。CDP 探针 + health check

### 4.2 Lexical Workspace Boundary（防 `..` 穿越）（P0）

- **claw-code 实现**：[permission_enforcer.rs:183-222](claw-code/rust/crates/runtime/src/permission_enforcer.rs#L183-L222) `is_within_workspace` + `lexically_normalize`：**先词法**展开 `..` 和 `.`，再比较前缀；不依赖 `canonicalize`（写入不存在路径时 canonicalize 会失败）。:498-522 有完整测试覆盖 `/workspace/../etc/passwd` 等
- **解决的问题**：天真字符串前缀比较被 `/workspacex/...` 绕过；`canonicalize` 在写入不存在路径时也会失败
- **BrowserOS 现状**：浏览器 Agent 主要操作 URL，但**下载/导出到磁盘**的场景必须校验
- **借鉴建议**：在 [packages/shared/src/](packages/browseros-agent/packages/shared/src/) 新建 `path-safety.ts`：
  ```ts
  export function lexicalNormalize(p: string): string {
    return path.posix.normalize(p.replace(/\\/g, '/'))
  }
  export function isWithinWorkspace(target: string, root: string): boolean {
    const t = lexicalNormalize(target) + '/'
    const r = lexicalNormalize(root) + '/'
    return t.startsWith(r)
  }
  ```
  单测覆盖 `C:\workspace\..\..\windows\system32` 等
- **适配难度**：低。30 分钟

### 4.3 Read-Only 启发式（白名单 + 否定 metachar）（P2）

- **claw-code 实现**：[permission_enforcer.rs:241-340](claw-code/rust/crates/runtime/src/permission_enforcer.rs) 50+ 命令的 read-only 名单，**先**扫描 `SHELL_METACHARS = [';', '|', '&', '$', '`', '>', '<', '(', ')', '{', '}', '\n']`，`python / node / cargo` 明确**排除**
- **解决的问题**：ReadOnly 模式下 `cat foo; rm bar` 链式攻击要拒，`python -c "..."` 因图灵完备要拒
- **BrowserOS 现状**：浏览器 Agent 不跑 shell，但 `browser_evaluate` 在页面里执行 JS 是等价的"可执行上下文"
- **借鉴建议**：在 `browser_evaluate` 工具加 `sandboxed: boolean` 参数：
  - `sandboxed=true` 拒绝访问 `RISKY_GLOBALS = ['fetch', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'window.open']`
  - 用 iframe sandbox 或轻量 JS 静态分析
- **适配难度**：中。需要静态分析或隔离执行环境

### 4.4 ApprovalToken + delegation_chain + replay 防护（P1）

- **claw-code 实现**：[approval_tokens.rs:118-345](claw-code/rust/crates/runtime/src/approval_tokens.rs) `ApprovalTokenGrant`：
  - `status (Pending / Granted / Consumed / Expired / Revoked)`
  - `max_uses`（默认 1）+ `expires_at_epoch_seconds`
  - `delegation_chain: Vec<ApprovalDelegationHop>` — 记录谁→谁委托
  - `ApprovalTokenLedger::consume` 自增 uses，达到 max 自动转 Consumed
  - `validate_grant` 在 4 处拒绝（状态/时间/已用/范围/执行人）
- **解决的问题**：批准"owner 给 release-bot 一次推 main 权限"——一次用完即失效、可设置过期、记录委托链便于审计
- **BrowserOS 现状**：有 OAuth 但**没有**"授权执行一个危险操作"的 token 化概念
- **借鉴建议**：在 [apps/server/src/agent/](packages/browseros-agent/apps/server/src/agent/) 加 `permissions/`：
  - `PermissionToken { scope: 'close-tab'|'delete-history'|'revoke-cookie'|'oauth.authorize', maxUses, expiresAt }`
  - 持久化在 `~/.browseros/permission-tokens.json`
  - 用户点"批准"创建 token，agent 调工具带 token，server 校验后消费
  - 工具调用日志写 delegation_chain
- **适配难度**：中。2 天，schema + UI 弹窗 + token 校验层

### 4.5 PolicyEngine 声明式策略（P2）

- **claw-code 实现**：[policy_engine.rs:39-103](claw-code/rust/crates/runtime/src/policy_engine.rs) `PolicyCondition` 支持 `And(Vec) / Or(Vec)`，`PolicyAction` 支持 `Chain(Vec<PolicyAction>)`，`PolicyEngine::new` 自动按 priority 排序；:540-572 测试展示"startup-recovery"规则触发 `RecoverOnce → Escalate` 链式
- **解决的问题**：把"何时做什么"做成可声明、可组合、可排序的策略，而不是散落 `if-else`
- **BrowserOS 现状**：工具权限判断硬编码散在每个 tool handler 里
- **借鉴建议**：在 [apps/server/src/agent/](packages/browseros-agent/apps/server/src/agent/) 加 `policy/`：`Policy { name, when: Condition[], then: Action | Action[], priority }`，引擎跑所有匹配规则、按 priority 排序、合并 actions
- **适配难度**：高。需重构现有权限点

---

## 五、工具输出管理（2 项）

### 5.1 BashCommandOutput 完整字段 envelope（P0）— **新发现，价值很高**

- **claw-code 实现**：[bash.rs:41-69](claw-code/rust/crates/runtime/src/bash.rs#L41-L69) `BashCommandOutput` 不只是 `{stdout, stderr}`，而是 14 字段：
  - `stdout / stderr` — 摘要
  - `raw_output_path` — 完整原始输出路径
  - `interrupted` — 是否被中断
  - `is_image` — 输出是否是图片
  - `background_task_id / backgrounded_by_user / assistant_auto_backgrounded` — 后台任务追踪
  - `dangerously_disable_sandbox` — 沙箱绕过标记
  - `return_code_interpretation` — `"test.hung"` 等语义化解读
  - `no_output_expected` — 命令本不应有输出（沉默是正常的）
  - `structured_content: Vec<Value>` — 结构化内容（可被 LLM 直接解析）
  - `persisted_output_path / persisted_output_size` — 溢出落盘的产物路径
  - `sandbox_status` — 沙箱实际生效状态
- **解决的问题**：LLM 需要的不只是"输出文本"，还需要"输出语义"（这是测试 hang 吗？是被中断的吗？是后台任务吗？沙箱生效了吗？）
- **BrowserOS 现状**：[tool-adapter.ts](packages/browseros-agent/apps/server/src/agent/tool-adapter.ts) 工具返回 `{ content: string, isError: boolean }`，字段稀疏
- **借鉴建议**：把工具输出 envelope 扩展为：
  ```ts
  type ToolResult = {
    content: string                  // 给 LLM 看的摘要
    isError?: boolean
    failureClass?: string            // 见 3.2
    persistedArtifactPath?: string   // 见 5.2
    persistedArtifactSize?: number
    backgroundTaskId?: string
    interrupted?: boolean
    noOutputExpected?: boolean
    structuredContent?: unknown      // JSON schema 友好的结构化数据
    metadata?: Record<string, unknown> // 工具特定元数据
  }
  ```
- **适配难度**：低-中。半天扩字段，工具逐个迁移

### 5.2 工具输出溢出持久化到磁盘（P1）

- **claw-code 实现**：[bash.rs:60-67](claw-code/rust/crates/runtime/src/bash.rs#L60-L67) `persisted_output_path / persisted_output_size` — 当输出超过 `MAX_OUTPUT_BYTES=16KB` 时不丢弃，写入临时文件，把路径返回给 LLM，模型可用 `read_file` 工具分页读取
- **解决的问题**：LLM 看到 `[output truncated — exceeded 16384 bytes]` 后只能瞎猜；持久化让模型按需读取完整输出
- **BrowserOS 现状**：[compaction/utils.ts:357](packages/browseros-agent/apps/server/src/agent/compaction/utils.ts#L357) 的 `reduceToolOutputs` 直接清空 >100 字符的输出，原始内容丢失
- **借鉴建议**：新建 `ArtifactStore`：
  - 截图、HTML dump、console log、网络响应体超过 N KB 落到 `~/.browseros/scratch/<conversation_id>/<tool_call_id>.{png,html,json}`
  - 工具返回 `persistedArtifactPath` + size
  - Agent 可用 `read_file` / `view_artifact` 工具再读
  - 会话结束（或 7 天后）自动清理
- **适配难度**：中。需要新建 store + 清理任务

---

## 六、MCP 生命周期（2 项）

### 6.1 McpLifecyclePhase 11 阶段 FSM（P1）

- **claw-code 实现**：[mcp_lifecycle_hardened.rs:14-28](claw-code/rust/crates/runtime/src/mcp_lifecycle_hardened.rs#L14-L28) `McpLifecyclePhase` 11 阶段：
  ```
  ConfigLoad → ServerRegistration → SpawnConnect → InitializeHandshake
            → ToolDiscovery → ResourceDiscovery → Ready
            → Invocation → ErrorSurfacing → Shutdown → Cleanup
  ```
  - :30-47 `all()` 返回所有阶段
  - `validate_phase_transition` 有限状态机校验合法转移（允许跳过 ResourceDiscovery，禁止 Cleanup → Ready）
  - :67-95 `McpErrorSurface { phase, server_name, message, context, recoverable, timestamp }` — 错误带"可恢复"标记
  - `McpDegradedReport` 汇总 `working_servers / failed_servers / available_tools / missing_tools`
- **解决的问题**：MCP server 启动/握手/调用全流程失败模式各异，统一 FSM 让上层"在 ResourceDiscovery 失败但 ToolDiscovery 成功时跳过资源，只用工具"
- **BrowserOS 现状**：[packages/agent-mcp-manager/](packages/browseros-agent/packages/agent-mcp-manager/) 有 MCP 客户端但**没有**显式 FSM，reconcile 时部分 server 失败处理散落
- **借鉴建议**：在 [packages/agent-mcp-manager/src/](packages/browseros-agent/packages/agent-mcp-manager/src/) 新建 `lifecycle/`：
  - `McpLifecyclePhase` enum（11 阶段）
  - `McpPhaseTransitionValidator` 校验合法转移
  - `McpLifecycleRecorder` 跟踪每 server 当前 phase
  - `McpDegradedReport` 让 UI 显示"server X 失败，可调用工具：a, b, c；缺失：d"
- **适配难度**：高。3 天，需重构现有 client

### 6.2 MCP 握手失败 Abort 策略（P0）

- **claw-code 实现**：[recovery_recipes.rs:284-334](claw-code/rust/crates/runtime/src/recovery_recipes.rs) `FailureScenario::McpHandshakeFailure` 的 recipe 只有 1 步 `RetryMcpHandshake { timeout: 5000 }`，且 `escalation_policy = Abort`（:314）—— MCP 握手失败**不**再重试，直接 abort
- **解决的问题**：MCP 握手失败通常意味着 server 协议不兼容或二进制损坏，无脑重试浪费 30s+
- **BrowserOS 现状**：MCP 失败通常 retry-with-backoff，浪费时间
- **借鉴建议**：在 [packages/agent-mcp-manager/](packages/browseros-agent/packages/agent-mcp-manager/) reconcile 时区分：
  - `transient`（超时、refused）→ retry with backoff
  - `protocol`（handshake 失败、版本不匹配）→ **Abort immediately**
  - `spawn`（找不到二进制）→ AlertHuman
- **适配难度**：低。30 分钟

---

## 七、任务调度与报告（3 项）

### 7.1 ValidatedPacket newtype 模式（P0）

- **claw-code 实现**：[task_packet.rs:101-191](claw-code/rust/crates/runtime/src/task_packet.rs) `ValidatedPacket` 是 `TaskPacket` 的 newtype，`validate_packet()` 返回 `Result<ValidatedPacket, TaskPacketValidationError>`，**累积所有错误不早退**（:115-191）。Legacy 字段（`acceptance_tests`）与新字段（`acceptance_criteria`）二选一即可通过验证（:124-132）
- **解决的问题**：新 schema 上线时旧 task 文件不能爆；"通过校验的 task"在编译期就和"待校验 task"区分开
- **BrowserOS 现状**：scheduled task 创建时校验可能不完整
- **借鉴建议**：在 [apps/app/lib/schedules/](packages/browseros-agent/apps/app/) 把 `ScheduleTask` 改造成 `ValidatedScheduledTask` newtype（TS 用 branded type 或 private constructor），`validateScheduleTask()` 累积所有错误
- **适配难度**：低

### 7.2 TaskRegistry + LaneBoard 三栏视图（P1）

- **claw-code 实现**：[task_registry.rs:105-200](claw-code/rust/crates/runtime/src/task_registry.rs) `TaskRegistry` 每 task 有 `LaneHeartbeat { observed_at, transport_alive }`，`lane_board(stalled_after_secs)` 返回 `{active, blocked, finished}` 三栏。`freshness_at` 把 heartbeat 映射成 `LaneFreshness`（`Healthy / Stalled / TransportDead / Unknown`）—— **与 SessionHeartbeat 四态完全一致**
- **解决的问题**：UI 需要"现在所有 sub-agent 在干嘛"的视图，三栏分类让用户秒懂
- **BrowserOS 现状**：有 scheduled task 但没有 sub-agent registry；多 workspace 也缺聚合视图
- **借鉴建议**：在 [apps/server/src/agent/](packages/browseros-agent/apps/server/src/agent/) 加 `registry/`：
  - `WorkspaceSessionRegistry`：注册每个 workspace 当前活跃的 session
  - `laneBoard()` 返回三栏视图
  - UI 加"活跃 workspace 面板"
- **适配难度**：中。需 ws 协议 + UI

### 7.3 ReportSchema 任务报告卡片（P2）

- **claw-code 实现**：[report_schema.rs](claw-code/rust/crates/runtime/src/report_schema.rs) 把任务结果结构化为可校验的 report
- **借鉴建议**：scheduled task 完成后给用户"报告卡片"：
  - 跑了哪些 step
  - 截图证据（base64 → 缩略图）
  - 失败的步骤 + 重试次数
  - 副作用清单（创建了哪些 tab、改了哪些 cookie）
- **适配难度**：中

---

## 八、OAuth 与凭据（2 项）

### 8.1 Credentials 原子写 + 字段保留（P0）

- **claw-code 实现**：[oauth.rs:371-380](claw-code/rust/crates/runtime/src/oauth.rs) `write_credentials_root`：写 `.tmp` 再 `rename`；`read_credentials_root` 解析整个 JSON object，merge 新字段（:285-292），`clear_oauth_credentials` 只删 `oauth` key 保留其他（:294-299）；:580-582 测试明确验证"清掉 OAuth 后其他字段还在"
- **解决的问题**：多套凭据（OAuth + API key + service account）共用一个 `credentials.json`，升级/清空一个不破坏另一个
- **BrowserOS 现状**：[apps/app/lib/llm-providers/storage.ts](packages/browseros-agent/apps/app/) 多 provider 共存，但字段合并到同一 JSON 时可能覆盖
- **借鉴建议**：在 [apps/server/src/storage/](packages/browseros-agent/apps/server/src/) 统一封装 `json-credentials.ts`：
  ```ts
  export async function setCredential(path: string, key: string, value: unknown)
  export async function clearCredential(path: string, key: string)
  // 全部走 atomic write-tmp-rename，clearCredential 只删 key 不动其他
  ```
- **适配难度**：低。2 小时

### 8.2 PKCE S256（RFC 7636）（P0）

- **claw-code 实现**：[oauth.rs:241-258](claw-code/rust/crates/runtime/src/oauth.rs) 生成 32-byte verifier、S256 challenge；`build_url` 正确 percent-encode 所有参数（:165-180）；`parse_oauth_callback_query` 安全解析 `?code=&state=`（:311-325）
- **解决的问题**：OAuth 公共客户端（无 secret）的安全基线
- **BrowserOS 现状**：已有 OAuth 流程，但应审计是否标准 PKCE
- **借鉴建议**：审 BrowserOS OAuth 客户端是否：
  - 用 `crypto.getRandomValues`（不是 `Math.random`）生成 verifier
  - SHA-256 + base64url 算 challenge
  - callback 严格验 `state` 防 CSRF
- **适配难度**：低（审计）。若已实现则无需改动

---

## 九、事件总线（1 项）

### 9.1 lane_events 核心 schema（精简版）（P0）

- **claw-code 实现**：[lane_events.rs](claw-code/rust/crates/runtime/src/lane_events.rs)（87KB）定义 100+ 事件类型，`ship.* / plan.* / worker.*` 等
- **借鉴建议**：**不要整套移植**（过度工程化）。只保留"核心事件 schema"作为统一日志/telemetry 契约，约 20 个事件：
  ```
  tool_invoked / tool_completed / tool_failed
  session_started / session_compacted / session_ended
  permission_denied / oauth_consumed / approval_granted
  schedule_fired / schedule_skipped / schedule_succeeded
  mcp_server_registered / mcp_server_failed / mcp_tool_invoked
  browser_tab_opened / browser_tab_closed / browser_navigation
  compact_boundary_created / artifact_persisted
  ```
  每个事件带 `{ type, timestamp, conversationId, payload }`
- **适配难度**：低。1 天 schema + 迁移关键日志点

---

## 十、明确**不**借鉴的设计

| 设计 | 文件 | 不借鉴原因 |
|---|---|---|
| GreenContract（多层绿测试契约） | [green_contract.rs](claw-code/rust/crates/runtime/src/green_contract.rs) | 浏览器 Agent 不产生 PR，无"merge 前测试必须绿"场景 |
| stale_base / stale_branch / branch_lock | 同名 .rs | 全是 git 工作流相关，BrowserOS 不需要 |
| lsp_client | [lsp_client.rs](claw-code/rust/crates/runtime/src/lsp_client.rs) | 代码补全/类型检查用 LSP，浏览器 Agent 无此需求 |
| lane_events 全套 | [lane_events.rs](claw-code/rust/crates/runtime/src/lane_events.rs) | 100+ 事件过度工程化，只取核心 ~20 个（见 9.1） |
| config_validate 30K 行 | [config_validate.rs](claw-code/rust/crates/runtime/src/config_validate.rs) | 重构级工作量，单独立项而非从 claw-code 移植 |
| git_context | [git_context.rs](claw-code/rust/crates/runtime/src/git_context.rs) | BrowserOS 不依赖 git 元数据进 prompt |

---

## 十一、落地路线图

### P0 — 直接可用，1 天内可落地（先做这批）

| # | 设计点 | 工作量 | 价值 |
|---|---|---|---|
| 1.3 | 压缩边界 tool_use/tool_result 配对保护 | 30 min | 防 OpenAI-compat 400 |
| 1.4 | 直接续写指令 | 10 min | 用户体验 |
| 1.5 | 多次压缩摘要合并 | 1 hr | 长 session 信息保留 |
| 1.6 | Grapheme-safe 截断 | 30 min | 防 emoji/CJK 截断 |
| 2.3 | JSONL Rotate | 2 hr | 持久化基础 |
| 3.2 | failureClass 错误归类 | 半天 | LLM 决策质量 |
| 4.2 | Lexical Workspace Boundary | 30 min | 安全 |
| 5.1 | ToolResult envelope 扩字段 | 半天 | 工具语义 |
| 6.2 | MCP 握手失败 Abort | 30 min | 节省 30s+ 重试 |
| 7.1 | ValidatedPacket newtype | 半天 | 配置完整性 |
| 8.1 | Credentials 原子写 | 2 hr | 凭据安全 |
| 8.2 | PKCE S256 审计 | 1 hr | OAuth 安全 |
| 9.1 | lane_events 核心 schema | 1 天 | 日志统一 |

### P1 — 中成本高价值，1-2 周

| # | 设计点 | 工作量 |
|---|---|---|
| 1.1 | Trident 多管道压缩（先做 Supersede 阶段） | 3 天 |
| 1.2 | 压缩后 Health Probe | 2 天 |
| 2.1 | workspace_fingerprint + SessionStore 分目录 | 2 天 |
| 2.2 | SessionHeartbeat 四态 | 2 天 |
| 2.4 | SessionFork | 2 天 |
| 3.1 | RecoveryRecipe + Ledger | 3 天 |
| 4.1 | SandboxStatus 字段化 | 1 天 |
| 4.4 | ApprovalToken + delegation_chain | 2 天 |
| 5.2 | ArtifactStore 溢出落盘 | 2 天 |
| 6.1 | McpLifecyclePhase FSM | 3 天 |
| 7.2 | TaskRegistry + LaneBoard | 3 天 |

### P2 — 重构级，按需

| # | 设计点 | 备注 |
|---|---|---|
| 1.7 | Redact + Truncate 二级防护 | 需谨慎避免误伤 |
| 4.3 | browser_evaluate sandbox | 需 JS 静态分析 |
| 4.5 | PolicyEngine 声明式策略 | 重构权限点 |
| 7.3 | ReportSchema 任务报告 | UI 工作量大 |

---

## 附录 A：claw-code 文件 → 设计点速查

| 文件 | 关联设计点 |
|---|---|
| `runtime/src/compact.rs` | 1.3、1.4、1.5、1.6 |
| `runtime/src/trident.rs` | 1.1 |
| `runtime/src/conversation.rs` | 1.2、3.1（动态阈值） |
| `runtime/src/session.rs` | 1.7、2.2、2.3、2.4 |
| `runtime/src/session_control.rs` | 2.1 |
| `runtime/src/recovery_recipes.rs` | 3.1、6.2 |
| `runtime/src/bash.rs` | 3.2、5.1、5.2 |
| `runtime/src/sandbox.rs` | 4.1 |
| `runtime/src/permission_enforcer.rs` | 4.2、4.3 |
| `runtime/src/approval_tokens.rs` | 4.4 |
| `runtime/src/policy_engine.rs` | 4.5 |
| `runtime/src/mcp_lifecycle_hardened.rs` | 6.1 |
| `runtime/src/task_packet.rs` | 7.1 |
| `runtime/src/task_registry.rs` | 7.2 |
| `runtime/src/report_schema.rs` | 7.3 |
| `runtime/src/oauth.rs` | 8.1、8.2 |
| `runtime/src/lane_events.rs` | 9.1 |

## 附录 B：claw-code 项目结构概览（删后留档）

```
claw-code/
├── rust/crates/
│   ├── runtime/         # 47 个 .rs 文件，~60K 行 — 核心运行时
│   │   └── src/
│   │       ├── compact.rs        压缩主逻辑
│   │       ├── trident.rs        三阶段压缩管道
│   │       ├── conversation.rs   Agent 主循环
│   │       ├── session.rs        会话+JSONL持久化
│   │       ├── session_control.rs SessionStore::from_cwd
│   │       ├── recovery_recipes.rs 错误恢复配方
│   │       ├── sandbox.rs        SandboxStatus
│   │       ├── permission_enforcer.rs 权限+路径校验
│   │       ├── approval_tokens.rs 一次性授权令牌
│   │       ├── policy_engine.rs  声明式策略
│   │       ├── mcp_lifecycle_hardened.rs MCP 11 阶段 FSM
│   │       ├── bash.rs           Bash 工具（含字段 envelope）
│   │       ├── oauth.rs          PKCE + 原子写凭据
│   │       ├── task_packet.rs    ValidatedPacket
│   │       ├── task_registry.rs  LaneBoard
│   │       └── lane_events.rs    事件总线（100+ 事件）
│   ├── api/             # 多 Provider 适配（anthropic/openai_compat）
│   ├── tools/           # 工具实现（单文件 10K+ 行）
│   ├── plugins/         # 插件系统
│   ├── commands/        # CLI 命令
│   ├── telemetry/       # 监控
│   ├── compat-harness/  # 兼容性测试
│   ├── rusty-claude-cli/ # CLI 入口
│   ├── claw-analog/     # 模拟服务
│   ├── claw-rag-service/ # 独立 RAG HTTP 服务
│   └── mock-anthropic-service/ # Mock 测试服务
├── PHILOSOPHY.md        # 项目哲学（自称 agent-managed exhibit）
├── PARITY.md            # 与官方 Claude Code 行为对齐清单
└── ROADMAP.md           # 路线图
```

## 附录 C：与 claude-code（主参考）的分工

| 设计主题 | 主参考 | 辅助参考 |
|---|---|---|
| 上下文压缩（基础） | claude-code 的三层 + POST_COMPACT 重注入 | claw-code 的 Trident 多管道（1.1）+ 配对保护（1.3） |
| 会话持久化 | claude-code 的 JSONL transcript | claw-code 的 rotate（2.3）+ fingerprint（2.1） |
| 错误恢复 | claude-code 的 PTL 三步降级 | claw-code 的 RecoveryRecipe Ledger（3.1） |
| 工具输出 | claude-code 的 POST_COMPACT 重注入 | claw-code 的字段 envelope（5.1）+ 持久化（5.2） |
| MCP | claude-code 的 InProcessTransport + Tool Search | claw-code 的 11 阶段 FSM（6.1） |
| Skills/Workflow/Sub-agent | **claude-code 独占**（claw-code 都是骨架） | — |
| Hooks | **claude-code 独占**（27 事件 vs claw-code 3 事件） | — |
| 沙箱/权限/ApprovalToken | claw-code（claude-code 较弱） | claw-code 的 4.1-4.5 |
| OAuth 凭据 | 平局 | claw-code 的原子写字段保留（8.1） |

---

**文档结束**。claw-code 项目可在此文档完成后安全删除。所有有价值的设计已提取并定位到 BrowserOS 内的具体落地位置。
