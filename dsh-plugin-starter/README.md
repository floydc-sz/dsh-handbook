# 制作 DeepSeek Harness 插件（起步包）

这个目录里有两个**可以直接安装**的示例插件，外加这份说明。

| 目录 | 是什么 | 装上去你会看到 |
|---|---|---|
| `hello-bundle/` | 只有 Host 半区的最小插件（3 个必需文件） | 宿主日志里多出 `[hello-bundle] loaded in profile …` 和卸载时的 `unloaded` |
| `badge-bundle/` | Host + Client 两半区的界面插件 | 聊天输入框所在区域多一个绿色小徽标「badge-bundle 已加载」 |

---

## 1. 三个概念，先分清

- **plugin（插件）**：一个导出 `apply(ctx)` 的模块（JS/TS 都行）。它通过 `ctx` 注册能力：工具、事件监听、服务、界面 slot。**只有 `apply` 是必需的**。
- **bundle（组合包）**：一个 npm 包，`package.json` 里声明 `dsh.bundle.patch` 指向一份 YAML patch。这份 patch 才是"往 profile 里插了哪几行插件"。**你写出来给人装的是 bundle。**
- **profile（配置档）**：`$DSH_HOME/profiles/<名字>` 目录，`dsh.profile.bundles` 列出启用哪些 bundle。你现在用的是 **desktop** profile（`C:\Users\CJL\.dsh\profiles\desktop`）。**使用者不手写 profile，由安装器维护。**

配置叠加顺序（后者覆盖前者，**按行 id 覆盖，且 `config` 是整块替换而不是深度合并**）：

1. profile 的 `dsh.profile.bundles` 里每个 bundle 的 patch，按列表顺序；
2. profile 自己的 `cordis.patch.yml`；
3. `$DSH_HOME/cordis.patch.yml`（整机共享）；
4. 启动时每个 `--patch <路径>` overlay，按命令行顺序。

## 2. 最小插件的 3 个文件

```
hello-bundle/
├── package.json       # 声明 dsh.bundle.patch
├── cordis.patch.yml   # 要插入的插件行
└── index.js           # 插件本体
```

`index.js` 的三种合法导出形态（**不要混用**）：

```js
// ① 函数形态（绝大多数情况用这个）
export const name = 'my-plugin'
export const inject = ['tools']          // 可选：等这些服务就绪后才调用 apply
export function apply(ctx, config) { /* 注册能力 */ }

// ② 对象形态
export default { name: 'my-plugin', inject: ['tools'], apply(ctx) {} }

// ③ 类形态：只有当这个插件对外提供服务时才用
import { Service } from '@deepseek-ai/cordis'
export default class MyService extends Service {
  static inject = ['tools']
  constructor(ctx) { super(ctx, 'myService') }
}
```

**清理是自动的**：凡是通过 `ctx` 注册的东西（事件、工具、定时器）在插件卸载时会自动回收，不用手写 `removeListener`。需要显式清理的资源（连接、句柄）才用 `ctx.effect()`，返回一个清理函数：

```js
export function apply(ctx) {
  ctx.effect(() => {
    const timer = setInterval(() => {}, 5000)
    return () => clearInterval(timer)   // 卸载时调用
  })
}
```

## 3. 想要界面，就加 Client 半区

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

`client.js` 必须用 Harness 模块加载器认识的形态（见 `badge-bundle/client.js`）：

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

- **不要 import Harness 的客户端包**（例如 `@deepseek-ai/dsh-client-ui-primitives`），只用 `require('react')` 和自己写的组件；
- 样式尽量用主题 token（如 `var(--dsh-text-secondary)`），才能在浅色/深色主题下都正常；
- slot 名和它的注册参数必须**查出来**再写，不要猜。查法见第 6 节；
- 想加工具、改上下文、加聊天气泡这类不只是"静态装饰"的需求，先确认扩展点再动手（官方 `references/practices.md` 讲这个）。

## 4. 安装到你的 profile

**桌面端（推荐，不用命令行）**：侧栏 **插件** → **添加插件** → 填入 bundle 目录的绝对路径，例如

```
D:\CaosCode\DeepSeek Harness\Test 2026093001\dsh-plugin-starter\hello-bundle
```

对话框接受：包名（可带版本）、Git 地址、压缩包、本地绝对路径。安装完成后可点「立即启用」。启用了 HMR 的 profile 通常刷新页面/约 1 秒内生效；**替换已安装包的新代码需要重启进程**。

**命令行等价物**（需要 `dsh` 在 PATH 上，你这台机器目前没有）：

```sh
dsh plugin --profile desktop add "D:\...\hello-bundle"
dsh --profile desktop --dump-config       # 不启动也能看到 "# == dsh-hello-bundle" 这一层
```

也可以分发成 npm 包、tarball 或 Git 地址（`github:you/hello-plugin`）。

## 5. 踩坑清单

- **TS 必须能产出构建结果**：从 Git 安装拿到的是源码，pnpm 不会跑你的 `build`；要提供自包含的 `prepare` 脚本，或者干脆发 npm / tarball。源码方式还有个坎：pnpm ≥10 默认拒绝跑依赖的构建脚本，首次安装会失败并列出待放行的包名，用户必须显式放行（这是"允许在本机执行该包代码"的授权，只对信任的包做，并锁 commit）。
- **别手写 profile 的 `package.json` / `cordis.patch.yml`**，也别在 profile 目录里手动跑 pnpm——安装器负责这些步骤。
- **id / name 要唯一**，patch 按 id 覆盖；整块替换 `config`，覆盖时要把该行需要的键全部重写。
- **`config` 必须有 schema**：插件想接受配置就要导出 `Config`（schema），否则不要给 patch 行写 `config`。
- **换代码要重启**：装了新包并启用可以热加载，但替换已安装包里的 JS，必须重启进程才会加载新模块。
- **展示元信息是可选的**：`locale/en.json`、`locale/zh.json` 里的 `meta.title` / `meta.description` 决定插件卡片文字，`package.json` 的 `icon`（≤256 KiB 的 SVG/PNG/JPEG/WebP）决定图标；缺失就回退到包名和默认插画。本项目里的 `locale/*.json` 就是按官方说明写的，如果卡片没读出文字，删掉它们不影响插件运行。

## 6. 怎么查 API，而不是靠猜

1. **在线检查（Creator 模式里 Agent 可用的工具）**：`cordis_inspect_list` + `cordis_inspect_query` 能查 Service 方法、Event 模式、某个已挂载插件的 `Config` JSON Schema、当前 Agent 能调用的 Tool 列表、以及**实时的 Client Slots 与主题 token**。装/卸/开关则用 `plugin_manager`（`install_bundle` / `list_plugins` / `set_plugin` / …）。这些工具在普通会话里不出现。
2. **包自带文档**：查到一个 entry 会给出 `packageDir`，读该目录下的 `README.md`；源码不在 `src/`，而是已经编译好的 `lib/index.js` 和 `lib/types/**/*.d.ts`（带 JSDoc）。
3. **本机就有的插件开发 skill**：桌面端把这个 skill 打在 `app.asar` 里（只有宿主进程自己的文件读取能打开它，shell/glob/node 都不行）：
   - `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/SKILL.md`
   - 同目录 `references/host-plugin.md`、`ui-plugin.md`、`mcp-bundle.md`、`practices.md`、`user-actions.md`、`verification.md`
   - `templates/decoration/`、`templates/mcp/`（本项目的两个示例就是照这两个模板改的）
4. **官方文档**：[Your first plugin](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)、[Build a tool](https://deepseek-harness.github.io/deepseek-harness/develop/basic/tool)、[Plugin configuration](https://deepseek-harness.github.io/deepseek-harness/develop/basic/config)、[Package and install](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)。

## 7. 加一个 Agent 工具（最常见的需求）

工具插件需要 `@deepseek-ai/dsh-tools` 的 `defineTool`，并 `inject: ['tools']`：

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

`defineTool` 会从 `parameters` 推导并校验 `args`；`execute` 返回 `output.schema` 声明的规范值，`output.render` 把它变成模型看到的内容。引用 dsh 自带包（`@deepseek-ai/dsh-tools`、`@deepseek-ai/cordis` 等）时，官方建议在 `peerDependencies` **和** `devDependencies` 里都声明：运行时用 dsh 安装里的那一份，devDependency 那份给你自己的类型检查和独立测试用。而"只是配置、不写代码"的需求更简单——直接写一个只含 `cordis.patch.yml` 的 bundle 就够了（例如挂 MCP 服务器，见 `templates/mcp/`）。
