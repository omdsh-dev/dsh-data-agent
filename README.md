# DSH Data Agent · 用对话分析数据

**中文** | [English](README.en.md)

<p align="center">
  <img src="assets/dsh-data-agent-banner.png" alt="dsh-data-agent HERO图" width="100%">
</p>
<p align="center">
  <img src="https://img.shields.io/github/v/release/omdsh-dev/dsh-data-agent?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/github/stars/omdsh-dev/dsh-data-agent?style=flat-square" alt="Stars">
  &nbsp;
  <img src="https://img.shields.io/npm/v/@yejiming%2Fdsh-data-agent?style=flat-square&label=npm" alt="npm">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>
<p align="center">
  <strong>让DeepSeek Harness连接数据库，用对话完成数据分析与商业洞察</strong><br>
  <em>自然语言查询 · 自动执行SQL · 连续分析 · Web UI · dsh-tui · 只读保护</em>
</p>

<p align="center">

[项目简介](#项目简介) · [主要功能](#主要功能) · [快速安装](#快速安装) · [Web UI](#在web-ui中使用) · [dsh-tui](#在dsh-tui中使用) · [安全说明](#安全说明)

</p>

## 项目简介

dsh-data-agent是给DeepSeek Harness（DSH）使用的数据分析插件：把数据库连接、库表浏览、SQL编写与执行、连续追问和结果解读串成一个会话工作流。它同时支持Web UI与dsh-tui，通过官方profile机制安装，不需要修改DSH源码。

业务人员真正想要的通常不是一条SQL，而是知道：发生了什么、为什么会发生、哪些客户或商品值得关注，以及下一步应该采取什么行动。

连接完成后，你可以像和数据分析师对话一样提出问题。DSH会自动查看库表、编写并执行SQL、根据结果继续分析，最终给出清晰的数据结论和商业洞察。

例如，你可以直接问：

- “过去90天销售额为什么下降？按地区和品类找出主要原因。”
- “哪些客户有流失风险？列出判断依据和建议的运营动作。”
- “分析本月新增用户的留存情况，并总结最值得关注的变化。”
- “找出复购率最高的商品组合，给出适合管理层阅读的结论。”

不需要先把问题翻译成SQL，也不需要在数据库工具、AI对话框和表格之间反复复制数据。你负责提出业务问题，DSH负责完成查询、验证和分析闭环。

## 主要功能

- **通过对话完成数据分析**：直接用自然语言描述目标，DSH会理解问题、拆解分析步骤、查询真实数据并整理结论。你可以继续追问，分析会沿着当前上下文逐步深入。
- **自动寻找商业洞察**：不仅返回查询结果，还能帮助比较趋势、定位异常、识别高价值客户或商品，并把数据转化为便于业务决策的说明。
- **完整兼容Web UI与dsh-tui**：喜欢可视化操作时，可以在Web界面连接数据库、浏览库表和查看结果，推荐使用[zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)；习惯键盘工作流时，可以在终端中使用同一“数据模式”，通过`/database`完成连接，然后直接开始对话分析，推荐使用[ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)。两种界面都能使用数据Agent的核心能力。
- **连接常见业务数据库**：支持MySQL、PostgreSQL、SQLite、Oracle、Hive和Impala，可用于业务系统、分析库、本地数据文件及数仓场景。
- **DSH自动完成分析闭环**：DSH会根据当前问题查看表结构、编写SQL、执行查询，并结合报错或返回结果继续调整，而不是只生成一段未经验证的SQL。
- **专注数据任务的数据模式**：会话只保留读写文件、查询数据库和执行SQL所需的能力，减少无关工具和上下文干扰，让DSH更专注于数据分析。
- **安全地使用真实数据**：支持只读模式和数据库只读账号；TUI密码会被隐藏，且不会作为表单草稿恢复。是否允许修改数据由你决定。

![数据库连接](assets/connection.png)

Web UI还提供内嵌数据库工作台，可以浏览库表、查看字段结构，或临时运行SQL。开始对话后，工作台会自动移到侧栏，不打断分析过程。

![数据库工作台](assets/tables.png)

创建会话时选择“数据模式”，DSH就会以数据分析工作流处理后续问题。

![数据模式预设](assets/settings.png)

## 快速安装

Web UI和dsh-tui使用独立的DSH profile。只使用其中一种界面时，安装对应的一项；两个界面都使用时，请执行两条命令。

### 方式一：npm安装（推荐）

```sh
dsh plugin --profile web add @yejiming/dsh-data-agent
dsh plugin --profile dsh-tui add @yejiming/dsh-data-agent
```

### 方式二：从GitHub安装

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-data-agent
dsh plugin --profile dsh-tui add github:omdsh-dev/dsh-data-agent
```

插件会自动安装“数据模式”预设，无需本地构建。

## 在Web UI中使用

启动Web UI：

```sh
dsh --profile web
```

然后按下面的步骤操作：

1. 新建会话并选择“数据模式”。
2. 在数据库工作台填写连接信息。
3. 连接成功后，直接在对话框中提出分析问题。
4. 根据第一轮结果继续追问，让DSH缩小范围、比较维度或总结结论。

例如，输入“分析最近30天订单变化，找出销售额下降最明显的地区和商品，并解释主要原因”，DSH会自行查看相关表、生成并执行查询，再根据真实结果完成分析。

## 在dsh-tui中使用

启动终端界面：

```sh
dsh --profile dsh-tui
```

在空白会话中切换到数据模式，然后连接数据库：

```text
/preset data-agent
/database connect
```

连接表单会一次展示所有相关字段。使用Tab或Shift+Tab切换输入项；数据库类型和只读模式按Enter展开选项，使用方向键选择并再次按Enter确认。

连接成功后，回到聊天输入框直接提出业务问题即可。常用的数据库命令还有：

```text
/database status       查看当前连接
/database test         测试当前连接
/database disconnect   断开当前连接
```

同一会话再次打开连接表单时，会恢复最近填写的数据库类型、地址、端口、用户、数据库和只读模式。密码始终隐藏且不会恢复。

![dsh-tui数据分析](assets/tui.png)

## 推荐的提问方式

为了获得更有价值的分析，可以在问题中补充业务目标、时间范围和关注维度。例如：

```text
分析2026年第二季度各地区的销售额和毛利率变化，找出表现异常的地区，
继续拆解到品类和核心客户，并给出三条可执行的业务建议。
```

你也可以让DSH保存分析过程或SQL，方便复查和复用：

```text
完成会员复购分析，把最终SQL保存到analysis/repurchase.sql，
并用一段适合周报的文字总结主要发现。
```

## 使用前准备

DSH运行查询时需要本机能够访问目标数据库，并安装相应的数据库客户端：

- SQLite通常已随macOS或Linux提供。
- MySQL需要`mysql`客户端。
- PostgreSQL需要`psql`客户端。
- Oracle、Hive和Impala需要各自的命令行客户端。

建议先准备一个只读数据库账号，让数据Agent在不修改业务数据的前提下完成探索和分析。

如果出现`failed to mount`或提示找不到`@yejiming/dsh-data-agent`，通常是当前profile还没有安装插件。请确认Web UI和dsh-tui分别执行了对应的安装命令，然后重新启动DSH。

## 安全说明

- 推荐使用数据库只读账号，并在连接表单中开启只读模式。
- Web UI和dsh-tui中的临时密码只用于当前连接；TUI只显示`*`，重新打开表单时不会恢复密码。
- 需要跨进程恢复认证时，可以使用DSH credential reference，避免在命令参数中输入明文密码。
- 未开启只读模式时，数据Agent可以按你的要求执行更新或管理语句。连接生产数据库前，请先确认账号权限和数据备份策略。
- 不同会话的数据库连接相互隔离，便于分别处理不同项目、客户或分析环境。

## 卸载与回滚

```sh
dsh plugin --profile web remove @yejiming/dsh-data-agent
dsh plugin --profile dsh-tui remove @yejiming/dsh-data-agent
rm -rf $DSH_HOME/.agent-presets/data-agent
```

卸载插件不会主动删除已经保存的非敏感连接信息。若需要彻底清理，请先备份，再删除DSH中对应的数据Agent存储记录。

## 本地开发

```sh
pnpm install
pnpm build
pnpm test
```

`lib/`已提交到仓库，因此通过npm或GitHub安装时无需自行构建。

## 许可

MIT

## 友情链接

- [dshfind.com](https://dshfind.com)：DeepSeek Harness中文学习与分享社区
- [dsh-web-ui](https://github.com/dsh-external/dsh-web-ui)：DeepSeek Harness Web UI插件与皮肤集合
- [dsh-cc-tui](https://github.com/dsh-external/dsh-cc-tui)：Claude Code风格的全屏终端界面
