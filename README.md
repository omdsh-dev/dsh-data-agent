# DSH Data Agent · 用对话分析数据与商业洞察

**中文** | [English](README.en.md)

<p align="center">
  <img src="assets/banner.webp" alt="DSH Data Agent Banner" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/omdsh-dev/dsh-data-agent?style=flat-square" alt="Version">
  &nbsp;
  <a href="https://dshfind.com/zh/plugins/omdsh-dev/dsh-data-agent?ref=badge"><img src="https://dshfind.com/api/badge/omdsh-dev/dsh-data-agent?lang=zh" alt="dshfind 小标"></a>
  &nbsp;
  <a href="https://dshfind.com/zh/plugins/omdsh-dev/dsh-data-agent?ref=badge"><img src="https://dshfind.com/api/badge/omdsh-dev/dsh-data-agent?metric=downloads&lang=zh" alt="dshfind 下载量"></a>
  &nbsp;
  <img src="https://img.shields.io/github/stars/omdsh-dev/dsh-data-agent?style=flat-square" alt="Stars">
  &nbsp;
  <img src="https://img.shields.io/npm/v/@yejiming%2Fdsh-data-agent?style=flat-square&label=npm" alt="npm">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>专为数据分析与商业分析人打造的 DeepSeek 智能数据分析助手</strong><br>
  <em>自然语言提问 · 自动编写执行 SQL · 智能图表与报告 · AI 辅助业务治理 · 深度商业洞察 · 本地安全只读</em>
</p>

<p align="center">

[产品亮点](#产品亮点) · [快速上手](#快速上手) · [使用场景](#使用场景) · [工作台与报告](#工作台与报告产物) · [支持数据源](#支持数据源) · [安全与隐私](#安全与隐私) · [常见问题](#常见问题) · [开源协议](#开源协议)

</p>

## 产品亮点

每次做数据分析，都要反复提需求写 SQL、手动导出 Excel 拼接加工、在多个图表工具里调格式？面对繁杂的库表和晦涩的英文缩写字段，业务含义无从查起？

**DSH Data Agent 让数据分析回归业务决策本身：**

- 💬 **零门槛对话即分析**：告别繁琐的 SQL 语法，直接用大白话提问（如“对比最近 30 天各渠道转化率”）。AI 会自动理解业务意图、探查库表结构、编写并执行查询、连续推演并输出清晰结论。
- 📊 **自动生成高品质图表与看板**：告别枯燥的纯文本与黑白表格。根据分析结论自动绘制折线图、柱状图、饼图、散点图或多维数据看板（Dashboard），并一键导出离线 HTML 报告方便分享汇报。
- 🧠 **深度挖掘商业洞察**：不止是罗列查询数字，还能自动比较波动趋势、定位异常原因、识别高价值客群与畅销品类，把冷冰冰的数据转化为可直接落地的业务建议。
- 🏷️ **AI 驱动的业务口径治理**：智能扫描数据库，自动为库表和字段标注通俗易懂的业务含义，支持人工审核与指标定义，确保每一次分析都基于统一、准确的业务口径。
- 🔒 **本地安全与只读保护**：原生支持只读账号与只读模式，查询分析全程在本地安全受控运行，凭据严格保密，保障企业生产数据安全无忧。
- 🖥️ **现代 Web 与高效终端双体验**：既可在直观的可视化 Web 界面中点击配置与浏览图表，也可在极客高效的命令行终端（dsh-tui）中一键唤起。

<p align="center">
  <img src="assets/features.webp" alt="DSH Data Agent 核心特性" width="100%">
</p>

## 快速上手

### 1. 运行环境准备

- **DeepSeek Harness**（DSH 运行时环境）
- 本机可访问目标数据库（支持本地 SQLite 文件或局域网/云端数据库）

### 2. 快速安装

在终端执行以下命令直接从 npm 安装插件：

```bash
# 安装到 Web 界面（推荐）
dsh plugin --profile web add @yejiming/dsh-data-agent

# 或安装到终端命令行（dsh-tui）
dsh plugin --profile dsh-tui add @yejiming/dsh-data-agent
```

### 3. 开始分析

#### 方式一：Web 界面（推荐）
启动 Web 控制台后，新建会话并选择 **「数据模式」**：
```bash
dsh --profile web
```
1. 在新会话页点击 **「数据模式」** 旁的 **「连接配置」**，或进入会话后点击输入框右上角的 **数据库图标**，在弹出的工作台中填写连接信息（支持测试连接）；
2. 连接成功后，直接在对话框中用自然语言提出你的业务分析问题；
3. 根据初步结论继续追问，AI 会沿着上下文层层下钻深挖。

#### 方式二：终端命令行（dsh-tui）
适合键盘流与极客用户，在终端中快速连接并展开分析：
```bash
dsh --profile dsh-tui
```
在会话中输入 `/preset data-agent` 切换模式，输入 `/database connect` 连接数据库，即可开始提问。

## 使用场景

| 场景分类 | 提示词示例 |
| :--- | :--- |
| 📈 **销售与营收复盘** | *"分析最近 30 天各渠道销售额与环比变化，找出下滑最明显的商品品类，并分析主要原因"* |
| 👥 **用户画像与客群分层** | *"根据近半年的购买频次和客单价对会员进行 RFM 分层，统计各层级用户的留存率与复购周期"* |
| 🛒 **运营转化与漏斗分析** | *"统计本月新用户从注册、搜索、加购到下单的各环节转化率，找出流失率最高的步骤"* |
| 📦 **库存与供应链监控** | *"排查周转天数超过 60 天的高库存 SKU，结合近期销售速度预测断货或积压风险"* |
| 📑 **周报 / 月报自动生成** | *"汇总上周核心业务指标（GMV、活跃用户数、客单价），生成一段适合汇报的管理层周报小结"* |

## 工作台与报告产物

### 1. 多功能数据库工作台
Web 界面内置一站式数据库工作台，包含 **连接配置**、**库表浏览**、**数据治理** 与 **SQL 执行** 四大功能模块，方便在对话之余随时查验数据资产。

<p align="center">
  <img src="assets/tables.webp" alt="数据库工作台" width="90%">
</p>

### 2. AI 辅助数据治理
在工作台中打开“数据治理”，AI 会自动扫描库表结构并生成直观的中文业务释义，支持逐项确认、删除与补充业务指标，告别“字段对齐全靠问同事”的尴尬。

<p align="center">
  <img src="assets/data-governance.webp" alt="AI 数据治理" width="90%">
</p>

### 3. 交互式离线分析报告
当分析需要可视化呈现时，Agent 会自动生成单图或多维 Dashboard，并自动在工作目录的 `analysis-reports/` 目录下保存独立的离线 HTML 报告。包含丰富的指标卡、动态图表与明细数据表，无需网络即可随时双击打开或发送给同事。

<p align="center">
  <img src="assets/charts.webp" alt="分析报告图表" width="90%">
</p>

## 支持数据源

DSH Data Agent 广泛支持各类主流业务数据库、分析型数仓及本地文件：

- 🐬 **关系型数据库**：MySQL, PostgreSQL, SQLite, Oracle, Microsoft SQL Server
- ⚡ **分析型数仓 / OLAP**：ClickHouse, Apache Doris, Apache Hive, Apache Impala
- 📁 **本地与轻量数据**：SQLite 数据文件（即开即用，无需额外服务）

## 安全与隐私

- 🛡️ **严格只读保护**：推荐使用只读数据库账号，并在连接时开启“只读模式”，确保不会意外修改或删除业务数据。
- 🔑 **凭据安全隔离**：连接密码仅在当前会话运行时使用，不记录在明文历史中，绝不上报远程服务器。
- 💻 **纯本地执行**：数据查询与分析报告生成均在本地安全受控运行，全面守护企业商业机密。

## 常见问题

<details>
<summary><b>Q: 我完全不会写 SQL，能用它做好数据分析吗？</b></summary>
完全可以！DSH Data Agent 专门面向非技术背景的业务人员与分析师设计。你只需用平时的业务语言描述需求，AI 会自动理解意图、查找对应的数据表、编写并执行准确的 SQL 查询，并将结果整理成通俗易懂的商业图表与结论。
</details>

<details>
<summary><b>Q: 连接生产数据库会不会有误删或误改数据的风险？</b></summary>
不会。我们建议连接时配置数据库只读账号并勾选“只读模式”。在只读保护下，任何写入、修改、删除（如 UPDATE, DELETE, DROP）等高危指令都会被严格拦截，保障生产数据绝对安全。
</details>

<details>
<summary><b>Q: 公司的数据库表名和字段都是缩写拼音/英文，AI 能看懂吗？</b></summary>
可以。你可以使用内置的“数据治理”功能，让 AI 结合表注释和字段上下文一键扫描生成业务释义，你也可以手动录入公司特有的术语和计算公式（如“净成交额 = 订单金额 - 退款金额”），AI 会在后续分析中自动采用这些经过确认的业务口径。
</details>

<details>
<summary><b>Q: 生成的分析报告如何分享给不使用 DSH 的同事或领导？</b></summary>
每次生成的图表报告都会在本地保存为独立的 <code>.html</code> 文件（位于 <code>analysis-reports/</code> 目录）。该文件内置了所有图表样式与交互数据，无需安装任何软件或连接网络，直接通过微信、邮件或钉钉发送给同事，用任意浏览器双击即可全屏查看与交互。
</details>

<details>
<summary><b>Q: 如果对分析出来的图表或结论有疑问，可以继续追问吗？</b></summary>
当然可以！就像和真实的专业分析师沟通一样，你可以在当前对话中继续追问（例如“再帮我按省份拆解一下”、“把柱状图换成饼图”、“为什么华东区 5 月份环比下降了”），AI 会基于上一步的结果继续深入分析。
</details>

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。

## 友情链接

- [dshfind.com](https://dshfind.com)：DeepSeek Harness 插件与生态发现社区
- [dsh-web-ui](https://github.com/dsh-external/dsh-web-ui)：DeepSeek Harness 可扩展 Web UI
- [dsh-cc-tui](https://github.com/dsh-external/dsh-cc-tui)：DeepSeek Harness 终端全屏交互界面
- [platonai/Browser4](https://github.com/platonai/Browser4)：面向智能体的大规模 Web 自动化浏览器引擎
