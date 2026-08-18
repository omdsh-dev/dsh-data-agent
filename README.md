# DSH Data Agent · 用对话分析数据

**中文** | [English](README.en.md)

<p align="center">
  <img src="assets/dsh-data-agent-banner.webp" alt="dsh-data-agent HERO图" width="100%">
</p>
<p align="center">
  <img src="https://img.shields.io/github/v/release/omdsh-dev/dsh-data-agent?style=flat-square" alt="Version">
  &nbsp;
  <a href="https://dshfind.com/zh/plugins/omdsh-dev/dsh-data-agent?ref=badge"><img src="https://dshfind.com/api/badge/omdsh-dev/dsh-data-agent?lang=zh" alt="dshfind 小标"></a>
  &nbsp;
  <img src="https://img.shields.io/github/stars/omdsh-dev/dsh-data-agent?style=flat-square" alt="Stars">
  &nbsp;
  <img src="https://img.shields.io/npm/v/@yejiming%2Fdsh-data-agent?style=flat-square&label=npm" alt="npm">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>
<p align="center">
  <a href="https://dshfind.com/zh/plugins/omdsh-dev/dsh-data-agent?ref=badge"><img src="https://dshfind.com/api/card/omdsh-dev/dsh-data-agent?lang=zh" alt="dshfind 展示卡" width="440"></a>
</p>
<p align="center">
  <strong>让DeepSeek Harness连接数据库，用对话完成数据分析与商业洞察</strong><br>
  <em>自然语言查询 · 自动执行SQL · 连续分析 · Web UI · dsh-tui · 只读保护</em>
</p>

<p align="center">

[项目简介](#项目简介) · [主要功能](#主要功能) · [快速安装](#快速安装) · [Web UI](#在web-ui中使用) · [dsh-tui](#在dsh-tui中使用) · [安全说明](#安全说明)

</p>

## 项目简介

dsh-data-agent是DeepSeek Harness（DSH）的数据分析插件。连接数据库后，直接提出业务问题，DSH会自动查看库表、编写并执行SQL、根据真实结果继续分析，最终给出清晰的数据结论和商业洞察。插件同时支持Web UI与dsh-tui，无需修改DSH源码。

![数据分析图表](assets/charts.webp)

## 主要功能

- **通过对话完成数据分析**：直接用自然语言描述目标，DSH会理解问题、拆解分析步骤、查询真实数据并整理结论。你可以继续追问，分析会沿着当前上下文逐步深入。
- **自动寻找商业洞察**：不仅返回查询结果，还能帮助比较趋势、定位异常、识别高价值客户或商品，并把数据转化为便于业务决策的说明。
- **跨界面HTML分析报告（render-analysis）**：Agent可在普通工具调用里自主生成单图或Dashboard式综合分析报告（metric/line/bar/pie/scatter/table视图）。每次成功调用都会在当前工作目录的`analysis-reports/`中保存一份离线可打开的HTML；Web同时提供内联预览与“查看分析”Modal，dsh-tui直接返回文件路径。是否画图由Agent按问题判断，schema探查、单标量等查询不会被强制生成图表。
- **完整兼容Web UI与dsh-tui**：喜欢可视化操作时，可以在Web界面连接数据库、浏览库表和查看结果，推荐使用[zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)；习惯键盘工作流时，可以在终端中使用同一“数据模式”，通过`/database`完成连接，然后直接开始对话分析，推荐使用[ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)。两种界面都能使用数据Agent的核心能力。
- **连接常见业务数据库**：支持MySQL、PostgreSQL、SQLite、Oracle、Hive和Impala，可用于业务系统、分析库、本地数据文件及数仓场景。
- **DSH自动完成分析闭环**：DSH会根据当前问题查看表结构、编写SQL、执行查询，并结合报错或返回结果继续调整，而不是只生成一段未经验证的SQL。
- **专注数据任务的数据模式**：会话使用DSH原生`str_replace_editor`处理文件，并保留`sql-query`、`sql-write`、`sql-cmd`与`render-analysis`；Web、Desktop、dsh-tui和headless profile使用同一工具协议。`describe_image`、`ssh_*`等宿主或社区插件工具不会进入数据模式。
- **安全地使用真实数据**：支持只读模式和数据库只读账号；TUI密码会被隐藏，且不会作为表单草稿恢复。是否允许修改数据由你决定。

Web UI还提供按需数据库工作台：点击输入框右上角的数据库按钮，即可在同一个Modal中配置连接、浏览库表、查看字段结构或临时运行SQL。开始对话前后都不占用输入框上方或左侧的对话空间。

![数据库工作台](assets/tables.webp)

创建会话时选择“数据模式”，DSH就会以数据分析工作流处理后续问题。

![数据模式预设](assets/settings.webp)

## 快速安装

以下命令将插件安装到Web profile。

### 方式一：npm安装（推荐）

```sh
dsh plugin --profile web add @yejiming/dsh-data-agent
```

### 方式二：从GitHub安装

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-data-agent
```

插件会自动安装“数据模式”预设，并在profile启动时预加载该预设的数据库工具与命令；选择预设时不再动态导入插件子路径，无需本地构建。

## 在Web UI中使用

启动Web UI：

```sh
dsh --profile web
```

然后按下面的步骤操作：

1. 新建会话并选择“数据模式”。
2. 点击输入框右上角的数据库按钮，在工作台Modal中填写连接信息。
3. 连接成功后，直接在对话框中提出分析问题。
4. 根据第一轮结果继续追问，让DSH缩小范围、比较维度或总结结论。

例如，输入“分析最近30天订单变化，找出销售额下降最明显的地区和商品，并解释主要原因”，DSH会自行查看相关表、生成并执行查询，再根据真实结果完成分析。

### 分析报告与HTML文件

数据模式提供render-analysis工具：Agent会先用sql-query探查并核对事实，再自行判断可视化是否有帮助。判断需要画图时，一次工具调用会生成一份版本化分析报告：

- 报告包含 1-6 个只读数据集与 1-8 个视图（metric、line、bar、pie、scatter、table），同一数据集可被多个视图复用，聚合与 Top N 都写在 SQL 中；
- 简单问题生成单个主图（结果行内联预览），复杂问题生成紧凑摘要 + 「查看分析」按钮；
- 「查看分析」在大型 Modal 中展示本次报告的全部视图：紧凑指标带、全宽主图、双列辅助图与明细表，浅色/深色主题与窄屏单列自适应；
- 无论当前使用哪种UI，完整Dashboard都会原子保存到会话工作目录的`analysis-reports/*.html`，并在支持的DSH界面进入“产物”栏；文件名默认使用报告标题，也可用语义化`outputName`指定basename，不追加长UUID；文件内联数据、样式和SVG渲染代码，断网时也能直接打开；
- 完整报告快照随会话日志持久化：刷新或历史回放不重新查询数据库，也不产生新的浏览器存储；
- Web仍从同一份报告meta渲染预览；Node侧HTML生成器不加载ECharts或Web client代码。

## 在dsh-tui中使用

把Data Agent安装到dsh-tui profile即可；`render-analysis`不要求特定dsh-TUI版本或scene能力：

```sh
dsh plugin --profile dsh-tui add @yejiming/dsh-data-agent
```

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

Agent生成分析报告后，工具卡会显示数据集、视图、空数据摘要与HTML绝对路径。TUI不会输出字符Dashboard，也没有`/analysis`命令；直接在本机浏览器中打开该HTML即可查看六类视图和原始数据。文件来自本次工具调用，`/resume`不会重新查询数据库。

同一会话再次打开连接表单时，会恢复最近填写的数据库类型、地址、端口、用户、数据库和只读模式。密码始终隐藏且不会恢复。

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

插件会先使用当前profile进程的PATH；找不到时，会继续检查客户端HOME环境变量以及Windows、macOS、Linux的常见安装位置，包括Homebrew、MacPorts、Linuxbrew、Snap、Nix、WinGet Links、Scoop、Chocolatey和Program Files下的版本目录。自动发现使用的补充PATH也会传给实际客户端进程，因此从Finder启动的DSH Desktop通常无需再为Homebrew客户端手工配置路径。

如果客户端安装在公司工具链或其他自定义目录，可在当前profile的`data-agent`配置中补充搜索目录；需要锁定具体版本时则直接填写绝对命令路径。当前profile的PATH始终优先，`searchPaths`在系统常见目录之前：

```yaml
- id: data-agent
  config:
    clients:
      mysql:
        searchPaths:
          - /opt/company/mysql/bin
        # command: /opt/company/mysql/bin/mysql
```

Windows路径可以写成`C:\Program Files\MySQL\MySQL Server 9.0\bin`。插件不会下载数据库客户端、执行登录shell或扫描整块磁盘；位于非常规目录且未进入PATH时，仍需使用`searchPaths`或`command`。

建议先准备一个只读数据库账号，让数据Agent在不修改业务数据的前提下完成探索和分析。

如果出现`failed to mount`或提示找不到`@yejiming/dsh-data-agent`，通常是当前profile还没有安装插件，或仍在使用旧版预设。请为Web UI、DSH Desktop或dsh-tui执行对应的安装命令，然后完全退出并重新启动DSH。未修改过的旧版预设会自动迁移；手工编辑过的预设需要删除其中指向`@yejiming/dsh-data-agent/tool`和`@yejiming/dsh-data-agent/command`的两行配置块。

## 安全说明

- 推荐使用数据库只读账号，并在连接表单中开启只读模式。
- Web UI和dsh-tui中的临时密码只用于当前连接；TUI只显示`*`，重新打开表单时不会恢复密码。
- 需要跨进程恢复认证时，可以使用DSH credential reference，避免在命令参数中输入明文密码。
- 未开启只读模式时，数据Agent可以按你的要求执行更新或管理语句。连接生产数据库前，请先确认账号权限和数据备份策略。
- 不同会话的数据库连接相互隔离，便于分别处理不同项目、客户或分析环境。

## 卸载与回滚

```sh
dsh plugin --profile web remove @yejiming/dsh-data-agent
dsh plugin --profile desktop remove @yejiming/dsh-data-agent
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
