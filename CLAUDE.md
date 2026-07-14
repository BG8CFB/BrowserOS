# CLAUDE.md

> 本文件指导 Claude Code (claude.ai/code) 在本仓库工作时遵循的约定。中文为主；代码、命令、文件路径、API、库名、专有名词保留英文。
> 与用户全局规范（`~/.claude/CLAUDE.md`、`~/.claude/rules/security.md`）冲突时，以**更严格的一方**为准；与系统/开发者消息冲突时，遵循更高优先级。
> 本文件只写**跨包、跨语言、项目级**的约束与速查。各 app 的细节在子包 CLAUDE.md 里（见 §7），不要把子包细节复制到本文件。

## 0. 一句话定位

BrowserOS 是一个开源 Chromium fork，原生跑 AI 代理。产品由两半组成、一起发布：

- **浏览器**（Chromium + patch）
- **agent 平台**（MCP server、浏览器扩展、CLI、eval harness）

第二条产品线 **BrowserClaw** 复用 agent 栈、换品牌，并额外维护一个 Rust server 端口。

这是一个**多语言 monorepo**：TypeScript (Bun)、Rust、Go、Python。每种语言有自己的工具链——**没有任何单一命令能构建整个仓库**。

## 1. 项目要点（速查）

| 维度 | 事实 |
|---|---|
| 仓库类型 | 多语言 monorepo（开源，AGPL-3.0） |
| 语言 / 运行时 | TypeScript (Bun 1.3.6)、Rust、Go 1.25+、Python (`uv`) |
| 仓库根 `package.json` | **不存在**——Bun workspace 根在 `packages/browseros-agent/` |
| Rust workspace 根 | `packages/browseros-agent/Cargo.toml` |
| 浏览器构建根 | `packages/browseros/`（需 ~100 GB Chromium 源码） |
| Go module | `packages/browseros-agent/apps/cli/`（仓库内唯一的 Go 模块） |
| 格式化 / Lint | TS/JS/JSON：Biome 2.5.0（ owning 在 `packages/browseros-agent/biome.json`）；Rust：`cargo fmt` + `cargo clippy`；Go：`gofmt` + `go vet` |
| Git hooks | `lefthook.yml`：commit-msg 强制 Conventional Commits，pre-commit 跑 Biome + 400 行警告，pre-push 提示分支命名 |
| 文档站 | `docs/`（Mintlify，发布到 docs.browseros.com） |
| 私有文档 | `.internal-docs/`（私有 submodule，SSH URL，默认不初始化） |

> 本仓库**未声明** `项目状态:` 机读字段。改动策略由全局规范的回退判定决定（成熟开源仓库 + 既有约定 → 默认按"维护修补 / 最小必要改动"处理），除非用户当前指令另有要求。

## 2. 仓库布局

```
BrowserOS/
├── packages/
│   ├── browseros/              # Chromium fork —— Python 构建系统 + patch（C++/Python）
│   └── browseros-agent/        # Agent 平台 monorepo（TS Bun workspaces + Rust workspace + Go module）
│       ├── apps/
│       │   ├── server/         # BrowserOS MCP server + AI agent loop（Bun、Hono）
│       │   ├── app/            # BrowserOS 浏览器扩展（WXT + React）
│       │   ├── cli/            # browseros-cli（Go、Cobra）—— 终端控制 BrowserOS
│       │   ├── eval/           # Benchmark harness（Bun）
│       │   ├── claw-server/    # BrowserClaw 后端（Bun、Hono）—— TS 端口
│       │   ├── claw-server-rust/ # BrowserClaw 后端 —— Rust 端口（活跃开发中）
│       │   ├── claw-app/       # BrowserClaw 浏览器扩展（WXT + React）
│       │   └── claw-onboard/   # BrowserClaw 首次运行引导（Vite）
│       ├── packages/           # 共享 TS workspace 包（shared、cdp-protocol、browser-core、browser-mcp、agent-mcp-manager、build-server-tools、onboarding-video）
│       ├── crates/             # 共享 Rust crate（browseros-cdp、browseros-core、browseros-mcp）
│       └── Cargo.toml          # Rust workspace 根
├── docs/                       # Mintlify 文档站（docs.browseros.com）
├── tools/                      # 发布工具
├── .internal-docs/             # 私有 submodule —— 见 §8
└── lefthook.yml                # Git hooks：Conventional Commits、Biome、分支命名
```

> `README.md` 提到的 `apps/controller-ext` 目录**已不存在**——README 在这一点上已过期，不要再去找它，也不要据此推断结构。

## 3. 嵌套克隆 —— 不属本仓库

`claude-code/` 和 `claw-code/` 位于 repo 根目录，但它们是**独立的 git 仓库**（各自有自己的 `.git`），只是被放进本工作树。它们在 `git status` 中显示为 untracked (`??`)，**不是** BrowserOS 跟踪树的一部分。它们各自有自己的 CLAUDE.md / AGENTS.md，自管。

- **不要**修改它们、不要 `git add` 它们（`.gitignore` 已排除）
- **不要**在 `apps/` / `packages/` 里 import 任何来自 `claude-code/` 或 `claw-code/` 的代码
- 可以读它们作为设计参考
- 升级、替换、删除由用户决定
- 除非任务**明确**指向它们，否则请在 `packages/` 内工作

## 4. 命令运行位置

不同任务在不同的目录起跑，下表是**唯一正确**的起始目录：

| 任务 | 起始目录 |
|---|---|
| TS/JS 脚本（Bun workspace 根） | `packages/browseros-agent/` |
| Rust workspace（build/test/clippy/fmt） | `packages/browseros-agent/` |
| 浏览器构建（Chromium） | `packages/browseros/` |
| Go CLI（build/test/release） | `packages/browseros-agent/apps/cli/` |

> Repo root **没有** `package.json`——不要在 root 跑 `bun install` 或 `bun run xxx`，会失败或踩坑。

## 5. 常用命令速查

### 5.1 Agent 平台（Bun，from `packages/browseros-agent/`）

```bash
bun install                              # 装依赖（Bun 1.3.6 pinned）

# 开发
bun run dev:watch                        # 启动 BrowserOS 完整开发环境
bun run dev:claw:watch                   # BrowserClaw 变体
bun run dev:claw-rust:watch              # BrowserClaw + Rust server
bun run dev:stop                         # 停掉 dev watcher

# 推送前必跑的检查
bun run check                            # lint + typecheck + fallow（unused/leak/circular）
bun run test                             # 等同于 bun run test:all
bun run test:main                        # 仅 server 测试（注意：不含 eval）
bun run --filter @browseros/eval test    # eval 测试只在 all suite 里

# 定向检查
bun run lint                             # bunx @biomejs/biome check
bun run lint:fix                         # biome check --write --unsafe（用它代替手工格式化）
bun run typecheck                        # 在每个 workspace 跑 typecheck
bun run fallow                           # 未用 export / 循环依赖 / 私有类型泄露

# 单文件 / 单包测试
bun test apps/server/tests/tools/foo.test.ts
bun run --filter @browseros/app test

# 构建
bun run build                            # build:server + build:agent
bun run build:server                     # 所有 server 目标 → R2
bun run build:server:test                # 仅 darwin-arm64、--no-upload
bun run build:agent                      # codegen + filter @browseros/app build
bun run build:claw-server                # TS BrowserClaw server
bun run build:claw-server-rust           # Rust BrowserClaw server（release）
bun run codegen:agent                    # 扩展的 GraphQL codegen
```

### 5.2 Rust workspace（from `packages/browseros-agent/`）

```bash
bun run build:rust          # cargo build --workspace
bun run test:rust           # cargo test --workspace
bun run lint:rust           # cargo clippy --workspace --all-targets -- -D warnings
bun run fmt:rust            # cargo fmt --all --check
```

Rust crate 包括：`apps/claw-server-rust`（server 二进制）和 `crates/browseros-{cdp,core,mcp}`（共享）。单 crate 测试：`cargo test -p browseros-core`。

### 5.3 浏览器（from `packages/browseros/`，需 ~100 GB Chromium 源码）

```bash
uv run browseros build --preset debug   --chromium-src /path/to/chromium/src
uv run browseros build --preset release --chromium-src /path/to/chromium/src
uv run browseros build --list           # 列出 pipeline 步骤与 preset
uv run browseros setup / apply / package / sign
```

patch 系统、版本锁定、签名细节见 [packages/browseros/README.md](packages/browseros/README.md) 和 [packages/browseros/bos_build/README.md](packages/browseros/bos_build/README.md)。

### 5.4 Go CLI（from `packages/browseros-agent/apps/cli/`）

```bash
gofmt -l .          # 必须没有输出
go vet ./...        # 或：make vet
go build ./...
go test ./...       # 单元测试，不需要 server
make test           # 集成测试（在 //go:build integration 编译标签后）
make release VERSION=x.y.z
```

## 6. 跨切约定

### 6.1 提交、分支与 Hook（`lefthook.yml`）

- **commit-msg**：强制 [Conventional Commits](https://www.conventionalcommits.org/) —— `<type>(<scope>)?: <desc>`，type ∈ `feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert`。不符合的提交消息**会被拒绝**（非提示、非警告）。
- **pre-commit**：在 `packages/browseros-agent/` 内对暂存的 TS/JS/JSON 跑 Biome `check --write`，并对**非测试** TS/TSX 文件超过 400 行的发出警告（提示拆分）。
- **pre-push**：分支命名 `<type>/<kebab-description>`（type ∈ `feat|fix|bugfix|hotfix|release|docs|refactor|test|chore|experiment`）。**仅警告，不阻断**；`main`/`master` 跳过检查。
- **禁止**用 `--no-verify` 绕过 hook。

### 6.2 格式化与 Lint

- TS/JS/JSON 的格式化与 import 顺序由 **Biome** 负责（配置：`packages/browseros-agent/biome.json`，2 空格缩进、单引号、`semicolons: asNeeded`、`noUnusedImports` / `noUnusedVariables` 为 error、`useSortedClasses` 为 error、`noExcessiveCognitiveComplexity` max 30 warn）。**禁止手工格式化**——跑 `bun run lint:fix`。
- Rust 跑 `cargo fmt --all --check` + `cargo clippy --workspace --all-targets -- -D warnings`。
- Go 跑 `gofmt -l .`（必须无输出）+ `go vet ./...`。

### 6.3 命名

| 对象 | 约定 | 示例 |
|---|---|---|
| 文件夹（TS monorepo） | kebab-case | `side-panel/` |
| 多词非组件文件（TS） | kebab-case | `vision-filter.ts` |
| 单词 utility/model 文件（TS） | lowercase | `logger.ts` |
| React 组件文件（app/claw-app） | PascalCase | `SeatCard.vue`（注：本项目无 Vue，示例为 `SeatCard.tsx`） |
| Hooks | `use` 前缀 | `useGameStream()` |
| Go 文件 | snake_case | `file_actions.go` |
| 分析事件常量（app） | SCREAMING_SNAKE_CASE，以 `_EVENT` 结尾 | `UI_MESSAGE_LIKE_EVENT` |
| 分析事件值 | `<area>.<entity>.<action>` | `ui.message.like`、`settings.managed_mcp.added` |

### 6.4 TypeScript import 规则

- **无扩展名**：`./utils`，不是 `./utils.js`（agent monorepo 全局）
- 例外：`claude-code/`（独立 repo，不属本仓库）
- Go module（`apps/cli/`）按 Go 规则，不按 TS 规则

### 6.5 共享常量与类型

- 共享常量集中在 [`@browseros/shared`](packages/browseros-agent/packages/shared/)：
  - `constants/ports`、`constants/timeouts`、`constants/limits`、`constants/urls`、`constants/paths`
  - `types/logger`
- **不要**在业务代码里散落魔法数字/字符串，先看 shared 里有没有
- 日志消息不要带 `[prefix]` 标签——dev 日志已自动加文件、行号、函数名

### 6.6 测试与覆盖率

- `bun run test:main` **不覆盖 eval**。eval 测试走 `bun run --filter @browseros/eval test` 或 `bun run test:all`（否则 eval 改动会"无测试通过"假象）
- Server 工具/浏览器/集成测试可能需要运行中的 BrowserOS/CDP target
- 本地 server 产物校验优先用 `bun run build:server:test`；若需全 target 但不上传 R2，用 `bun scripts/build/server.ts --target=all --no-upload`
- Eval 测试以 monorepo 根为 cwd，fixture 路径是 workspace-root 相对（如 `apps/eval/configs/...`）

### 6.7 仓库卫生

- **`AGENTS.md` 在 repo root 被 gitignore**——不要提交它（即使本地有）
- **`.internal-docs/`** 是私有 submodule（SSH URL），默认不初始化。需要时按 §8 处理
- 临时脚本、临时日志放 `.ai_temp/`（已 gitignore），不要污染 `src/`、`test/`、repo root

## 7. BrowserOS vs BrowserClaw

两条产品线共享 agent 平台：

| 产品线 | 位置 |
|---|---|
| BrowserOS | `apps/server`、`apps/app` |
| BrowserClaw | `apps/claw-server`、`apps/claw-server-rust`、`apps/claw-app`、`apps/claw-onboard` |

`claw-server`（TS）与 `claw-server-rust`（Rust）**暴露同一 MCP 表面**；Rust 端口是当前活跃的 server 工作主战场（见 recent commits）。

**关键铁律**：改 MCP 工具契约（工具名、参数 schema、返回结构）时，必须**同时**同步三处：

1. `apps/server`（BrowserOS TS server）
2. `apps/claw-server` + `apps/claw-server-rust`（BrowserClaw TS / Rust 端口）
3. `apps/cli`（Go CLI 按工具名调用 MCP，参数 key 也是契约）

少一处都会导致 CLI 调用失败或产品线之间行为分裂。

## 8. 子包深度索引

每个 app 与 agent 根都有自己的 CLAUDE.md，写明该层独有的约定、入口点、坑。**在对应区域工作前先读它**：

| 子包 CLAUDE.md | 覆盖内容 |
|---|---|
| [packages/browseros-agent/CLAUDE.md](packages/browseros-agent/CLAUDE.md) | agent monorepo 总规则（Bun、无扩展名 import、共享常量、kebab-case、no barrels） |
| [apps/server/CLAUDE.md](packages/browseros-agent/apps/server/CLAUDE.md) | Hono 路由、MCP 工具注册表、CDP 浏览器层、agent loop、发布门禁（不准打包 Lima/VM 资源） |
| [apps/app/CLAUDE.md](packages/browseros-agent/apps/app/CLAUDE.md) | WXT 扩展、TanStack Query 双 lane、GraphQL codegen、shadcn 生成 primitives、`react-hook-form + zod`、Sentry、UI 自检脚本 |
| [apps/cli/CLAUDE.md](packages/browseros-agent/apps/cli/CLAUDE.md) | Go Cobra CLI、MCP 客户端、exit-code 约定、release/artifact-name 契约、自更新 |
| [apps/eval/CLAUDE.md](packages/browseros-agent/apps/eval/CLAUDE.md) | eval runner、suite vs config、grader、agent 类型、viewer-manifest 契约、API key 防泄露 |
| [packages/browseros/README.md](packages/browseros/README.md) | Chromium patch 系统、构建 CLI、签名 |

> 注意：`apps/claw-server-rust/`、`apps/claw-app/`、`apps/claw-onboard/` 目前**没有**独立的 CLAUDE.md，参照相邻的 BrowserOS 对等 app 与本根文件。

## 9. 内部文档（私有 submodule）

`.internal-docs/` 是私有 submodule（SSH URL，默认不初始化），保存非公开的运维与架构上下文。

- `/ask-internal` skill 会把它和代码库合起来回答 BrowserOS 的 setup / feature / 架构问题
- **若一个问题同时混合"怎么跑 / 怎么配 X"与代码知识，优先用 `/ask-internal` 而不是 ad-hoc grep**
- 若 submodule 未初始化且任务需要它，先和用户确认是否拉取（不要自行换 HTTPS URL 或猜测内容）

## 10. 红线 / 易踩坑（项目特有汇总）

下表汇总本仓库分散在各 sub-CLAUDE.md / 配置文件中的"不要做"，**这些不是新增规则，是已有约束的索引**：

| 类别 | 禁止 / 警告 | 出处 |
|---|---|---|
| 仓库边界 | 不要修改 / git-track `claude-code/`、`claw-code/` | §3、`.gitignore` |
| 仓库边界 | 不要 commit `AGENTS.md`（repo root gitignored） | §6.7、`.gitignore` |
| 仓库边界 | 不要从 `claude-code/` / `claw-code/` 复制 / import 任何代码到 `apps/`、`packages/` | §3 |
| MCP 契约 | 不要只改一个 server 端的 MCP 工具表面而不同步另外两端 | §7 |
| Server 发布 | 不要把 VM-only Lima 资源打进 server 生产包（`scripts/build/config/server-prod-resources.json` 必须排除 `third_party/lima` 和 `resources/vm/`，由 `scripts/build/server/stage.test.ts` 卡） | [apps/server/CLAUDE.md](packages/browseros-agent/apps/server/CLAUDE.md) |
| 生成文件 | 不要手改 GraphQL 生成（`generated/graphql/`）、shadcn primitives（`components/ui/`、`components/ai-elements/`）、`.fallowrc.json` 跳过它们 | [apps/app/CLAUDE.md](packages/browseros-agent/apps/app/CLAUDE.md) |
| 浏览器层 | Server 工具**不要**直接说原始 CDP，用 `src/browser/` 抽象层 | [apps/server/CLAUDE.md](packages/browseros-agent/apps/server/CLAUDE.md) |
| 工具注册 | Server MCP 工具**必须**走 `src/tools/registry.ts`，不要旁路 | [apps/server/CLAUDE.md](packages/browseros-agent/apps/server/CLAUDE.md) |
| App 状态获取 | 不要用 `useEffect + useState` 取服务端状态，用 TanStack Query；不要在组件 body 里直接发网络请求 | [apps/app/CLAUDE.md](packages/browseros-agent/apps/app/CLAUDE.md) |
| App 错误捕获 | 不要用 `console.error` 报运行时错误，用 Sentry (`sentry.captureException`) | [apps/app/CLAUDE.md](packages/browseros-agent/apps/app/CLAUDE.md) |
| App 表单 | 不要 `useState`-per-field，用 `react-hook-form + zod`（`zod/v3` 入口）+ shadcn `Form` | [apps/app/CLAUDE.md](packages/browseros-agent/apps/app/CLAUDE.md) |
| App 分析 | 不要传裸事件字符串，永远走 `track()` + 事件常量 | [apps/app/CLAUDE.md](packages/browseros-agent/apps/app/CLAUDE.md) |
| Eval 安全 | **永远不要**把 API key 泄露到 persisted output（manifest、report、dashboard）；`publicMetadata` 已经 drop 掉 key | [apps/eval/CLAUDE.md](packages/browseros-agent/apps/eval/CLAUDE.md) |
| Eval 配置 | `apiKey` 是 ALL_CAPS 时按 env var 名解析；保持 `packages/shared/src/env/registry.ts` 同步、加变量后跑 `bun run env:examples` | [apps/eval/CLAUDE.md](packages/browseros-agent/apps/eval/CLAUDE.md) |
| Eval 文件位置 | `agisdk-evaluate.py` / `infinity-evaluate.py` 必须留在 `src/graders/python/`，`tests/grading/python-script-layout.test.ts` 会卡 | [apps/eval/CLAUDE.md](packages/browseros-agent/apps/eval/CLAUDE.md) |
| CLI 规则 | `apps/cli/` 是 Go module，**不适用** TS 规则（无扩展名 import / Bun / kebab-case 文件名都不适用） | [apps/cli/CLAUDE.md](packages/browseros-agent/apps/cli/CLAUDE.md) |
| CLI 版本 / Key | 不要硬编码 version 或 analytics key——它们是 build-time `-ldflags -X` 注入 | [apps/cli/CLAUDE.md](packages/browseros-agent/apps/cli/CLAUDE.md) |
| CLI artifact 名 | 不要重命名 `browseros-cli_<version>_<os>_<arch>.<tar.gz|zip>`——npm postinstall 和 `checksums.txt` 依赖该固定名 | [apps/cli/CLAUDE.md](packages/browseros-agent/apps/cli/CLAUDE.md) |
| CLI 错误处理 | 不要在 cmd 里 `fmt.Println` 错误或直接 `os.Exit`，走 `output.Error(msg, code)` / `output.Errorf(...)`（exit code：1=RPC 失败、2=page 解析失败、3=参数非法） | [apps/cli/CLAUDE.md](packages/browseros-agent/apps/cli/CLAUDE.md) |
| CLI server URL | 不要手工拼 `/mcp`，`normalizeServerURL` 已经处理（base 不带 `/mcp`，transport 会再补） | [apps/cli/CLAUDE.md](packages/browseros-agent/apps/cli/CLAUDE.md) |
| CLI page 定位 | 不要新增 `BROWSEROS_PAGE` env 或"active page"回退——必须显式 `--page/-p`，由 `TestRequireExplicitPageID` 卡 | [apps/cli/CLAUDE.md](packages/browseros-agent/apps/cli/CLAUDE.md) |
| 测试覆盖 | 不要把 eval 改动只跑 `bun run test:main` 就当通过 | §6.6 |
| Hook | 不要用 `--no-verify` 绕过 lefthook | §6.1 |
| 密钥 | 不要把 API key、token、凭据写进代码、提交信息、测试快照、文档、日志（详见 `~/.claude/rules/security.md`） | 全局 security.md |

## 11. 与全局规范的对接

| 全局规范主题 | 本项目 override / 补充 |
|---|---|
| 改动策略 | 本仓库未声明 `项目状态:`，按全局回退判定：成熟开源 + 既有约定 → **最小必要改动**为主，避免顺手重构；用户明确要求"新功能 / 重构 / 大改"时切到标准可维护改动 |
| 验证 | 推送前**必须**跑对应语言的检查（§5）+ 受影响 app 的子包测试；UI 改动用 CDP inspector 或 dev:watch 自检（见 [apps/app/CLAUDE.md](packages/browseros-agent/apps/app/CLAUDE.md)） |
| 注释 | 默认不写；写就写"为什么"（隐藏约束、非直观不变量、外部契约、坑），不写"做了什么"、不写日期/作者/变更日志 |
| 安全 | 在 `~/.claude/rules/security.md` 基础上，本项目特有：API key 防泄露（eval）、MCP 工具契约同步（双 server + CLI）、CDP 抽象层不绕开 |
| 提问配额 | 嵌套克隆、内部 submodule、跨产品线契约等场景容易踩边界，遇到不确定优先查 sub-CLAUDE.md 或 `/ask-internal`，再决定是否反问 |

## 12. 工作流速查（"我要做 X，先做啥"）

| 我要…… | 先读 / 先跑 |
|---|---|
| 改 server MCP 工具 | [apps/server/CLAUDE.md](packages/browseros-agent/apps/server/CLAUDE.md) → 改 `src/tools/` → 同步 BrowserClaw + CLI（§7）→ `bun run test:main` |
| 改扩展 UI | [apps/app/CLAUDE.md](packages/browseros-agent/apps/app/CLAUDE.md) → `bun run codegen:agent`（若改 GraphQL）→ `bun run dev:watch` + CDP inspector 自检 |
| 改 Go CLI 命令 | [apps/cli/CLAUDE.md](packages/browseros-agent/apps/cli/CLAUDE.md) → `gofmt -l .` + `go vet` + `go test ./...` |
| 改 Rust server | `apps/claw-server-rust/`（无独立 CLAUDE.md，参照 server Hono 路由与 BrowserClaw MCP 表面）→ `bun run test:rust` + `cargo test -p <crate>` |
| 跑 eval / benchmark | [apps/eval/CLAUDE.md](packages/browseros-agent/apps/eval/CLAUDE.md) → `bun run --filter @browseros/eval test` |
| 改浏览器（Chromium） | [packages/browseros/README.md](packages/browseros/README.md) → `uv run browseros build --preset debug` |
| 回答"怎么跑 / 怎么配" | 先 `/ask-internal`（读 `.internal-docs/` + 代码） |

---

**最近更新**：2026-07-13（翻译为中文、按子包索引与速查表重组；内容与原版对齐，未新增项目规则）
