# DeepSeek Harness 实战指南：GitHub 集成 · 插件开发 · 上架插件市场

> 整理自 2026-10-01 对 **DSH Desktop**（profile: `desktop`）的实测，以及 DSH 安装包内自带的
> `cordis-plugin-development` skill、dshmarket 本地源码与官方文档。
> 涉及版本行为的细节（字段、默认值、CI 规则）以你当前 DSH 版本和官方文档为准。

## 目录

- [第 1 部分 · 在 DSH 里使用 GitHub](#第-1-部分--在-dsh-里使用-github)
- [第 2 部分 · 制作 DSH 插件](#第-2-部分--制作-dsh-插件)
- [第 3 部分 · 上架与更新到 dshmarket](#第-3-部分--上架与更新到-dshmarket)
- [附录 A · 环境准备与常见障碍](#附录-a--环境准备与常见障碍)
- [附录 B · 速查表](#附录-b--速查表)

---

# 第 1 部分 · 在 DSH 里使用 GitHub

DSH 没有"绑定 GitHub 账号"这种一键功能。GitHub 是通过下面 4 条互不相同的路径用起来的。

| 路径 | 用途 | 前置 |
|---|---|---|
| ① shell 里跑 `git` / `gh` | 克隆、提交、推送、开 PR、看 issue | 装 Git（建议加 GitHub CLI 并登录） |
| ② GitHub MCP 服务器 | 让模型直接调 GitHub API | 一个 PAT；远端方式无需 Node |
| ③ 从 GitHub 安装 DSH 插件 | `github:owner/repo`、`gist:...` | git（安装前有连通性检查） |
| ④ GitHub webhook → 自动评审会话 | PR 变 ready for review 时自动建只读评审会话 | TLS 反代 + webhook 密钥 |

## 1.1 路径一：让会话里的 Agent 直接操作 GitHub

DSH 没有 GitHub 专用工具，它是通过 shell 工具（Windows 上是 `pwsh`）执行 `git` / `gh`。你只要用自然语言下指令：

> "把 `owner/repo` 克隆到工作区" / "看下 issue #12，修掉它并提 PR" / "把当前改动提交到新分支并推送"

前置条件：

1. 装 **Git for Windows**（提供 `git.exe`）；
2. 建议再装 **GitHub CLI**（`gh`），然后在**工作区外的终端**执行一次 `gh auth login`。

注意：`gh auth login` 会把凭据写进 `%APPDATA%\GitHub CLI`，这在工作区之外，工作区写沙箱（`workspace-write`）会拒绝；登录请在 DSH 之外的终端做一次，或在会话里批准完全权限。克隆/提交本身写在工作区内，没有问题。

## 1.2 路径二：挂 GitHub MCP 服务器

DSH 内置 MCP 客户端 `@deepseek-ai/dsh-mcp-client`，**默认一台服务器都不连**。配置写在 profile 补丁里（默认 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`，随附 `@deepseek-ai/dsh-mcp-resources` 提供资源读取）。连上后工具名形如 `mcp__github__create_issue`。

### 远端 Streamable HTTP（推荐，不需要 Node）

```yaml
- insert:
    - id: mcp-github
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: github
        transport: streamable-http
        url: https://api.githubcopilot.com/mcp/
        headers:
          Authorization: !!js '`Bearer ${process.env.GITHUB_PAT}`'
```

地址与鉴权方式见 [GitHub 官方文档：Setting up the GitHub MCP Server](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server)（官方 `github/github-mcp-server` 仓库另有 Docker / 二进制形式）。

### 本地 stdio（需要 Node 的 `npx` 或 Docker）

```yaml
    - id: mcp-github-local
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: github
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-github']
        env:
          GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN
```

> `@modelcontextprotocol/server-github` 是旧的参考实现，官方现在的本地形态是 `github/github-mcp-server`（Docker 镜像或发行二进制）。上例保留是因为它出现在 DSH 自己的 MCP 文档里。

### 字段与行为

| 字段 | 默认值 | 含义 |
|---|---|---|
| `transport` | 必填 | `stdio` 或 `streamable-http` |
| `serverName` | 必填 | 工具命名空间，`[A-Za-z0-9_-]{1,32}`，同一作用域内唯一 |
| `command` / `args` / `env` / `cwd` | — | stdio：可执行文件、参数、叠加在**已清洗环境**之上的额外变量、工作目录 |
| `url` / `headers` | — | streamable-http：端点与额外请求头 |
| `toolCallTimeoutMs` | `60000` | 每次 `tools/call` 或资源请求的超时 |
| `maxInstructionBytes` | `32768` | 服务器指令的 UTF-8 字节上限，超出则连接失败 |
| `failOnStartupError` | `false` | 初次连接/工具同步失败时是否拒绝激活插件 |
| `reconnect.enabled` | `true` | 断线自动重连（500ms 起翻倍，上限 30s，连续失败 10 次后移除工具） |

关键注意点：

- **stdio 桥启动子进程前会清掉所有 `DSH_*` 变量和名字像凭据的环境变量**，所以 token 只能写在该行的 `config.env` 里（或用 `!!js process.env.X`，前提是宿主进程本身有该变量）；远端 HTTP 方式用 `headers`。
- 改完是 HMR 热重载，约 1 秒生效，不用重启（配置写坏了会挡启动）。
- 工具命名是 `mcp__<serverName>__<rawName>`，两个服务器各有 `search` 会并存为 `mcp__github__search` / `mcp__web__search`；两条配置用同名 `serverName` 会在加载时明确报错。
- 密钥也可统一放 `$DSH_HOME/.credentials.yaml` 的凭据机制里，再用引用取。

## 1.3 路径三：从 GitHub 安装 DSH 插件

插件市场（dshmarket）和 DSH 的 `plugin_manager` 都接受 git 地址：`github:owner/repo`、`gist:...`。

- `plugin_manager` 的 `installBundle` 在调用 pnpm 之前会先用 `git ls-remote` 做一次**连通性检查**（`githubConnectionTimeoutMs` 默认 5000ms，会禁用凭据助手与交互式提示），所以这条路径需要 `git`。
- 中国大陆网络可在 市场 → **设置 → 插件 → 插件配置 → GitHub 加速**里填一个 HTTPS 代理前缀（运维的 `DSHM_GITHUB_PROXY` 优先级更高）。
- 等价 CLI：`dsh plugin --profile <profile> add github:owner/repo`。
- **从 Git 安装拿到的是源码而不是构建产物**，pnpm 不会跑你的 `build`；作者要提供自包含的 `prepare`，或者改发 npm / tarball。

## 1.4 路径四：GitHub webhook → 自动评审会话（DSH 原生）

DSH 随附 `@deepseek-ai/dsh-webhook-github`：给 `dsh web` 加一个签名端点，**PR 从 draft 变为 ready for review 时，自动在对应 Web Workspace 下创建一个只读评审会话**。

前置条件：

- 一个可由 DSH 注册为 Web Workspace 的本地 checkout；
- 高熵 webhook 密钥，通过 `DSH_GITHUB_WEBHOOK_SECRET` 凭据引用；
- 能把公网 URL 转发到 loopback 的 TLS 反向代理 / tunnel；
- GitHub webhook 订阅 **Pull requests** 事件，content type `application/json`。

启动（overlay 默认 Workspace 为启动目录、监听 `127.0.0.1:3081`，可用 `DSH_GITHUB_REVIEW_WORKSPACE` / `DSH_GITHUB_WEBHOOK_PORT` 覆盖）：

```sh
export DSH_GITHUB_WEBHOOK_SECRET="$(openssl rand -hex 32)"
dsh web --patch /absolute/path/to/github-review/cordis.yml
```

要点：

- 主 Web UI 与 `/api` 仍在 3080；overlay 在隔离 realm 里挂第二个 WebServer，**只有 `POST /github`**，其他路径 404。
- **安装包里没有 `apps/cli/config/examples/github-review`**（实测桌面端 app.asar 内不存在 examples 目录），需要从源码仓库取那个 overlay，或自己写 patch（把 `github-ready-review-rule.mjs` 放到 `$DSH_HOME/profiles/web/cordis.patch.yml` 旁边并追加对应行）。
- `202` 只表示签名与 JSON 被接受、规则调用已调度，**不代表匹配成功或会话已创建**；webhook 密钥只验证入站，不给规则或 Agent 出站权限。
- 详见 [GitHub review sessions 文档](https://deepseek-harness.github.io/deepseek-harness/guide/github-review)。

## 1.5 其它相关点

- **只读访问 GitHub 内容**（读文档、看代码）用内置的 `web_fetch` / `web_search` 即可，不需要 git。
- **不要期待"用 GitHub 账号登录 DSH"**：安装包里只有 pi-ai 内部的 `github-copilot` provider，而设置页的第三方 provider 不支持 OAuth（官方文档明确写了 Codex 这类暂不支持）。
- **插件市场支持用私有 Gist 跨机同步 profile 备份**（带鉴权的 Gist 请求直连 `api.github.com`，Bearer token 不交给公共加速服务）。

---

# 第 2 部分 · 制作 DSH 插件

## 2.1 三个概念

- **plugin（插件）**：一个导出 `apply(ctx)` 的模块，`apply` 里通过 `ctx` 注册能力（工具、事件、服务、界面 slot）。只有 `apply` 是必需的。
- **bundle（组合包）**：一个 npm 包，`package.json` 里声明 `dsh.bundle.patch` 指向一份 YAML patch，那份 patch 决定"往 profile 里插哪几行插件"。**你产出并分发的是 bundle。**
- **profile（配置档）**：`$DSH_HOME/profiles/<名字>`，`dsh.profile.bundles` 列出启用哪些 bundle。**使用者不手写 profile**，由安装器维护。

配置叠加顺序（后者覆盖前者；**按行 id 覆盖，且 `config` 是整块替换而不是深度合并**）：

1. profile 的 `dsh.profile.bundles` 里每个 bundle 的 patch，按列表顺序；
2. profile 自己的 `cordis.patch.yml`；
3. `$DSH_HOME/cordis.patch.yml`（整机共享）；
4. 启动时每个 `--patch <路径>` overlay，按命令行顺序。

## 2.2 最小插件：三个文件

```
hello-bundle/
├── package.json       # 声明 dsh.bundle.patch
├── cordis.patch.yml   # 要插入的插件行
└── index.js           # 插件本体
```

```json
{
  "name": "dsh-hello-bundle",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "index.js",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
# cordis.patch.yml —— 与 --patch overlay 同一种方言，只是按包名引用
- insert:
    - id: hello-bundle
      name: dsh-hello-bundle
```

```js
// index.js
export const name = 'hello-bundle'
export const inject = ['tools']          // 可选：等这些服务就绪后才调用 apply
export function apply(ctx, config) { /* 注册能力 */ }
```

三种合法导出形态（**不要混用**）：

```js
// ① 函数形态（绝大多数情况）
export const name = 'my-plugin'
export const inject = ['tools']
export function apply(ctx, config) {}

// ② 对象形态
export default { name: 'my-plugin', inject: ['tools'], apply(ctx) {} }

// ③ 类形态：只有对外提供服务时才用
import { Service } from '@deepseek-ai/cordis'
export default class MyService extends Service {
  static inject = ['tools']
  constructor(ctx) { super(ctx, 'myService') }
}
```

**清理是自动的**：通过 `ctx` 注册的东西（事件、工具、定时器）在插件卸载时自动回收；需要显式清理的资源才用 `ctx.effect()` 并返回清理函数：

```js
export function apply(ctx) {
  ctx.effect(() => {
    const timer = setInterval(() => {}, 5000)
    return () => clearInterval(timer)
  })
}
```

## 2.3 界面插件：加 Client 半区

`package.json` 里多一段 `dsh.client`，并导出 `./client`：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "immediately": true,
    "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
  }
}
```

`client.js` 必须用 Harness 模块加载器认识的形态：

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-badge-bundle',          // 与包名一致
  factory(require) {
    const React = require('react')        // react 由客户端运行时提供
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
          { name: 'conversation.composer.dock', id: 'dsh-badge-bundle', order: 5 },
          MyComponent,
        ))
      },
    }
  },
})
```

要点：

- **不要 import Harness 的客户端包**（例如 `@deepseek-ai/dsh-client-ui-primitives`），只用 `require('react')` 和自己的组件；
- 样式尽量用主题 token（如 `var(--dsh-text-secondary)`），才能同时适配浅色/深色主题；
- **slot 名和注册参数要查出来再写，不要猜**；
- 想加工具、改上下文、加聊天气泡这类不只是静态装饰的需求，先确认扩展点（官方 `references/practices.md` 讲这个）。

## 2.4 安装到 profile

**桌面端（推荐，不用命令行）**：侧栏 **插件** → **添加插件** → 填 bundle 目录的**绝对路径**，对话框也接受包名（可带版本）、Git 地址、压缩包。

**命令行等价物**：

```sh
dsh plugin --profile <profile> add /absolute/path/to/hello-bundle
dsh --profile <profile> --dump-config     # 不启动也能看到 "# == dsh-hello-bundle" 这一层
```

启用了 HMR 的 profile 通常约 1 秒内生效；**替换已安装包里的 JS 必须重启进程**才会加载新模块。

## 2.5 踩坑清单

- **TS 从 Git 装会缺构建产物**：pnpm 不跑你的 `build`，要提供自包含的 `prepare`；且 pnpm ≥10 会拦住依赖的构建脚本，用户必须显式放行（那等于允许该包代码在本机执行，只对信任的包做并锁 commit）。想省事就发 npm 或 tarball。
- **别手写 profile 的 `package.json` / `cordis.patch.yml`**，也别在 profile 目录里自己跑 pnpm。
- **patch 按 id 覆盖，`config` 整块替换**：覆盖别人的行时要把该行需要的键全部重写。
- **写了 `config` 就必须导出 `Config`（schema）**，否则不要给那行写 config。
- **id / name 要唯一**；两条配置用同一个 `serverName`/id 会在加载时报错。
- **展示元信息是可选的**：`locale/{en,zh}.json` 的 `meta.title` / `meta.description` 决定卡片文字，`package.json` 的 `icon`（≤256 KiB 的 SVG/PNG/JPEG/WebP）决定图标；缺失回退到包名与默认插画。

## 2.6 怎么查 API，而不是靠猜

1. **在线检查（Creator 模式里 Agent 可用的工具）**：`cordis_inspect_list` + `cordis_inspect_query` 能查 Service 方法、Event 模式、某个已挂载插件的 `Config` JSON Schema、当前 Agent 可用的 Tool 列表、以及**实时 Client Slots 与主题 token**；`plugin_manager`（`install_bundle` / `list_plugins` / `set_plugin` / …）负责装、卸、开关。这些工具在普通会话里不出现。
2. **包自带文档**：查到 entry 会给 `packageDir`，读该目录的 `README.md` 与已编译的 `lib/index.js`、`lib/types/**/*.d.ts`（带 JSDoc）。源码 checkout 才是 `packages/<group>/<name>/src`。
3. **DSH 安装包内的 skill**：桌面端位于 `app.asar` 内的
   `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`（`SKILL.md` + `references/{host-plugin,ui-plugin,mcp-bundle,practices,user-actions,verification}.md` + `templates/{decoration,mcp}`）。只有宿主进程自己的文件读取能打开 asar，shell / glob / node 都不行。
4. **官方文档**：[Your first plugin](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)、[Build a tool](https://deepseek-harness.github.io/deepseek-harness/develop/basic/tool)、[Plugin configuration](https://deepseek-harness.github.io/deepseek-harness/develop/basic/config)、[Package and install](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)、[Plugin lifecycle](https://deepseek-harness.github.io/deepseek-harness/develop/framework/)。

## 2.7 加一个 Agent 工具

需要 `@deepseek-ai/dsh-tools` 的 `defineTool` 与 `inject: ['tools']`：

```js
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: { name: { type: 'string', required: true, description: 'The name to greet' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return `Hello, ${args.name}!` },
  }))
}
```

`defineTool` 从 `parameters` 推导并校验 `args`；`execute` 返回 `output.schema` 声明的规范值，`output.render` 把它转成模型看到的内容。

引用 dsh 自带包时，按官方建议在 `peerDependencies` **和** `devDependencies` 里都声明：运行时用 dsh 安装里的那一份，devDependency 那份供你的类型检查和独立测试使用。**peer 范围必须带显式预发布分支**（见 [3.3](#33-让安装体验做对)），否则会静默排除预发布 harness 版本。

## 2.8 本仓库的示例

| 目录 | 是什么 | 装上去会看到 |
|---|---|---|
| `dsh-plugin-starter/hello-bundle/` | 只有 Host 半区的最小插件 | 宿主日志出现 `[hello-bundle] loaded in profile …` 与卸载日志 |
| `dsh-plugin-starter/badge-bundle/` | Host + Client 两半区的界面插件 | 输入框区域多一个绿色徽标 |
| `dsh-plugin-starter/README.md` | 插件开发速查（本部分的加长版） | — |

---

# 第 3 部分 · 上架与更新到 dshmarket

**dshmarket 自己没有投稿入口**：它的目录来自精选列表 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。市场每次打开都实时请求 `awesome-dsh-plugin.com/plugins.json`（每日 CI 刷新；大陆区域优先从 npm 镜像读同一份目录；刻意不做本地快照兜底）。所以"更新到 dshmarket" = **向那个列表提一个 PR**。

## 3.1 链路

```
你在 awesome-dsh-plugin 提 PR：data/plugins/<owner>__<repo>.yml
        ↓ 合并后 CI 重新生成 README + 站点
awesome-dsh-plugin.com/plugins.json（每日刷新，npm 上也有镜像副本）
        ↓ dshmarket 每次打开实时请求
设置 → 插件市场 里出现你的插件卡片
```

## 3.2 仓库体检（CI 会卡的硬条件）

| 要求 | 说明 |
|---|---|
| **`package.json` 声明 `dsh.bundle`** | 只声明 `dsh.client` 是**最常见的被拒原因**（那样无法安装）。monorepo 的根包或 `packages/`·`plugins/`·`apps/` 子包声明亦可，`cordis.patch.yml` 要和它并排 |
| 真实可用代码 | 占位仓库、空壳、纯 README 不收 |
| **仓库创建满 1 天** | CI 自动检查，只过滤"PR 前几分钟才建的仓库"；没达标就做完再提交 |
| 加 `dsh-plugin` topic | GitHub 仓库 topic |
| 活跃维护 | 定期扫描会标记消失/归档/长期停更的条目并移除 |
| 不是纯聚合包 | 只列依赖、自己不带行为的 meta-package 不单独收录；依赖必须指向上游原作者的仓库或 npm 包 |

## 3.3 让安装体验做对

- **发 npm**：预构建安装跳过 `allowBuilds` 构建授权。已发布包的 `repository` 字段必须指回被收录的那个仓库；**不要手写 `npm:` 字段**（会被校验拒绝），映射从 registry 自动采集。
- **不发 npm 也行**：把预构建 tarball 挂到 GitHub Release，并在条目里写 `tarball:`（必须 GitHub 托管的 https `.tgz`）。
  ⚠️ `latest/download/` 只在请求时解析 `latest`，**文件名是照字面取的**——资产名带版本号的话，提交当天有效、下次发版就 404。要么资产名不带版本，要么钉死 tag。
- **官方 `@deepseek-ai/*` 包用 `peerDependencies` 声明**，别放 `dependencies`。并且范围要带**显式预发布分支**：

  ```jsonc
  // ❌ 看着很宽，实际匹配不到 0.1.0-rc.6（node-semver 的预发布规则）
  "peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.2.0" }
  // ✅ 在 0.1.0 元组上带预发布标签
  "peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.2.0-0" }
  ```
- **截图（可选、推荐）**：在仓库里放 `screenshots.json`（`package.json` 旁边，monorepo 放子目录内），1–8 张、相对路径、不得跳出插件目录；也接受 GitHub 托管的 https 绝对 URL。不声明的话市场会从 README 自动抽图。放自己仓库的好处是换图不用再提 PR。
- 别忘了 `locale/{en,zh}.json` 的 `meta.title`/`meta.description` 与 `package.json.icon`——市场卡片与详情页读的就是它们。

## 3.4 提 PR（一个文件就是全部投稿）

新增 **`data/plugins/<owner>__<repo>.yml`**（双下划线）：

```yaml
url: https://github.com/owner/repo        # 必须与仓库完全一致
name: owner/repo                          # 列表里显示的链接文字
category: ui                              # 见下方分类
description:
  en: One-line description ending with a period.
  zh: 一句话描述，以句号结尾。               # 可选，不写维护者会补
# tarball: https://github.com/owner/repo/releases/latest/download/your-plugin.tgz  # 可选
```

- **只有 `description.en` 必填**；描述里含 `: `（冒号+空格）必须给整行加引号，否则 YAML 解析失败。
- **monorepo 子包**：`url` 指向子目录，`name` 用 `owner/repo#subname`，文件名变成 `owner__repo--packages-my-plugin.yml`。
- **一个 PR 最多 3 条**，超出 CI 拒绝并要求拆分；多插件时还要"挑"。
- **只改自己的条目**：README 是生成的，不要手改。本地预览：`npm ci && node scripts/generate-readme.mjs`。
- 描述**必须属实**（会被拿去和代码核对，包括数字与 API 名），不带营销词；分类挑最接近的即可，选不准维护者会直接改，不会因为分类被打回。
- `category` 可选值：
  `agi` `ui` `usage` `theme` `model` `identity` `session` `memory` `tools` `wsl` `browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify` `dev` `security` `remote` `market` `fun`
  主题/皮肤务必放 **`theme`**，会自动进入市场的「主题」Tab。
- CI 顺序：条目数 → `dsh.bundle`（从你仓库根包或 `packages/`·`plugins/`·`apps/` 子包读取）→ 仓库年龄 → `awesome-lint` + 站点构建。失败会明说改什么，**在同一分支推修复即可**，不用重开 PR。
- 提交前先自己装一遍验证：桌面端 侧栏**插件** → **添加插件** → 填 `github:owner/repo`（或本地绝对路径）。

合并后站点与市场自动重建收录，通常一天内生效。

## 3.5 以后发新版：多数情况不用再提 PR

市场会逐插件检测更新——npm 包按版本号、源码安装按锁定 commit 对比仓库 HEAD，卡片上有「更新内容」链接（能对上就用版本说明，对不上给提交记录）。所以发新版只要：

- 发 npm：`npm version patch && npm publish`（同步写好 changelog / Release notes，它会成为「更新内容」）；
- 或打 GitHub tag/Release：Release notes 即更新说明；
- 或直接 push 到默认分支（源码安装的用户按 HEAD 比较）。

**需要再提一个 PR** 的情况：改描述、换分类、改 `url` / `tarball`、仓库迁移，或下架。

> 口径差异提醒：市场 README 说有逐插件「一键更新」，而插件安装对话框写着"安装后暂不支持自动更新，升级需先卸载再装新版"。以你界面上实际显示的为准；卡住时先卸载再装新版总是有效。

## 3.6 参考链接

- [awesome-dsh-plugin 贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)（收录规则、CI 检查、截图与 tarball 约定）
- [插件目录](https://awesome-dsh-plugin.com/) · [dsh-market 仓库](https://github.com/dsh-market/dsh-market)
- [DeepSeek Harness 文档](https://deepseek-harness.github.io/deepseek-harness/)

---

# 附录 A · 环境准备与常见障碍

## A.1 Windows 上补齐工具链

DSH 桌面端**不保证** `git` / `gh` / `node` / `npm` / `pnpm` 在 `PATH` 上（本机实测都没有）。可用的安装方式：

```powershell
winget install --id Git.Git -e --scope user
winget install --id GitHub.cli -e --scope user
gh auth login          # 会写 %APPDATA%\GitHub CLI，建议在 DSH 之外的终端做
```

DSH 自己也带了一套 Node/pnpm 运行时（`~/.dsh/dsh-runtimes/<runtime>/dependencies/{node,pnpm,python}`），Agent 可以通过 `load_workspace_dependencies` 拿到它们的绝对路径，用它们做语法检查、跑脚本，而不必全局装 Node。

## A.2 沙箱与批准

- 会话默认文件策略通常是 `workspace-write`：**只能写工作区**。写工作区外的路径（如 `%APPDATA%`）、安装软件、改系统设置都会请求批准。
- Windows 上如果工作区目录缺少"写入所有者"权限，**所有命令都会在沙箱准备阶段就失败**（报 `SetNamedSecurityInfoW failed ... grantWrite`）。DSH 有专门的 skill（`diagnose-windows-sandbox-acl`）用一条命令诊断并修复，并打印可撤销的恢复命令。
- PowerShell 若报"禁止运行脚本"，可在同一进程内临时放开：`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force`。

## A.3 没有 git 时怎么把文件送到 GitHub

三条路，按侵入性从小到大：

1. **准备文件 + 自己推**：把文档和代码准备好，附一份 `push.ps1`，在你的终端里跑（不必把 token 交给会话）。
2. **用 GitHub REST API 提交**：不需要 git，用任意 HTTP 客户端调 `POST/PUT /repos/{owner}/{repo}/contents/{path}`，或用 Git Data API（blobs → tree → commit → 更新 ref）做**单次多文件提交**。需要 PAT（fine-grained 只需目标仓库的 Contents: read/write）。
3. **先装 git**（winget），再 `git init/add/commit/remote/push`。首次提交前记得 `git config user.name / user.email`。

---

# 附录 B · 速查表

| 项目 | 值 / 命令 |
|---|---|
| DSH home | `$DSH_HOME`（默认 `~/.dsh`） |
| profile 目录 | `$DSH_HOME/profiles/<profile>`（桌面端为 `desktop`） |
| 插件配置补丁 | `$DSH_HOME/profiles/<profile>/cordis.patch.yml` |
| 凭据文件 | `$DSH_HOME/.credentials.yaml` |
| 装插件（CLI） | `dsh plugin --profile <profile> add <spec>` |
| 看合成配置 | `dsh --profile <profile> --dump-config` |
| 带 overlay 启动 | `dsh web --patch <overlay.yml>` |
| Web UI / API 端口 | 3080 |
| webhook 评审监听 | `127.0.0.1:3081`，仅 `POST /github` |
| MCP 工具命名 | `mcp__<serverName>__<rawName>` |
| 市场目录 | `awesome-dsh-plugin.com/plugins.json`（可被 `DSHM_REGISTRY_URL` 覆盖） |
| 上架提交物 | `data/plugins/<owner>__<repo>.yml`（一个 PR 最多 3 条） |
| 桌面端装插件入口 | 侧栏 **插件** → **添加插件** |

---

*本指南随附示例代码见 [`dsh-plugin-starter/`](./dsh-plugin-starter/)。收录规则、CI 行为等由上游仓库随时调整，提 PR 前请再核对一次最新的 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。*
