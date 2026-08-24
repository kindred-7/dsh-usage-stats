# DSH Usage Stats（dsh-usage-stats）

[English](README.en.md) | 中文

DSH web 用量统计插件：在 **设置** 中新增「使用统计」页 —— 累计/峰值 Tokens、连续天数、近一年热力图、各模型用量曲线图。

## 功能

- **统计卡片**：第一行 累计 Tokens / 单日峰值 / 今日；第二行 当前连续天数 / 最长连续天数
- **近一年用量热力图**（GitHub 贡献图风格）
  - SVG 自适应宽度，完整一年一屏呈现，不出现横向滚动
  - 横轴显示月份标签（每月起始位置，自动防重叠）
  - 未使用的日子显示灰色方块，明暗主题自适应
  - 悬停方块显示「日期 · 用量」tooltip（与 DSH 原生 Tooltip 视觉一致）
- **各模型用量曲线图**（近 7 / 30 / 90 天切换）
  - 每个模型一条折线，有量的日子叠加圆点标记
  - 悬停显示当日各模型具体用量（日期 + 分模型 tokens），tooltip 同为 DSH 原生样式
- 明暗主题自适应 · 遵循 reduced-motion

## 安装

```powershell
cd %USERPROFILE%\.dsh\profiles\web
pnpm add @kindred7/dsh-usage-stats
pnpm exec dsh-usage-register
dsh web    # 重启生效
```

从 GitHub 安装指定版本：

```powershell
pnpm add github:kindred-7/dsh-usage-stats#v0.2.0
```

卸载：`pnpm exec dsh-usage-register --remove` 后 `pnpm remove @kindred7/dsh-usage-stats`。

安装后浏览器 **Ctrl+F5 硬刷新**一次，加载新插件脚本。

## 数据口径与隐私

- token 数 = 每条 assistant 回复的 provider 上报用量（input + output + cache 读 + cache 写；reasoning 已含在 output 内，不重复计）
- 模型归属取该请求日志记录的 `source.model`，同会话中途切换模型时按各自请求分别计入
- 数据仅存于本机浏览器 localStorage（键 `dsh-usage-stats/ledger/v1`），不上传任何服务器
- 账本按会话水位线增量累计：打开会话时自动从宿主日志对账回填完整用量（含历史）

## 工作原理

| 槽位 | 作用 |
|---|---|
| `conversation.composer.dock` | 隐形采集器（渲染 null），探测会话快照变化并触发宿主日志对账 |
| `settings.section` | 「使用统计」设置页 |

对账通过 `session.history` RPC 向后分页拉取完整日志，逐条折叠 `assistant/message` 事件（usage / 时间 / `source.model`），以事件 seq 为水位线去重。日志不可读（损坏/离线）时静默跳过，等下次触发再试。

## 开发

```powershell
node --check lib/client.js     # 语法检查
node tests/harness.cjs         # 账本折叠逻辑测试
```

`lib/client.js` 是浏览器端插件主体；`register.js` 负责把插件写入 profile 的启动清单；`cordis.patch.yml` 声明宿主侧装配。`.dsh/profiles/web/node_modules` 里的安装位是指向本目录的 Junction，改代码即生效。

## License

MIT
