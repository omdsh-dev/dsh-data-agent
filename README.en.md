# DSH Data Agent · Data Analysis & Business Insights via Conversation

[中文](README.md) | **English**

<p align="center">
  <img src="assets/banner.webp" alt="DSH Data Agent Banner" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/omdsh-dev/dsh-data-agent?style=flat-square" alt="Version">
  &nbsp;
  <a href="https://dshfind.com/en/plugins/omdsh-dev/dsh-data-agent?ref=badge"><img src="https://dshfind.com/api/badge/omdsh-dev/dsh-data-agent" alt="dshfind badge"></a>
  &nbsp;
  <a href="https://dshfind.com/en/plugins/omdsh-dev/dsh-data-agent?ref=badge"><img src="https://dshfind.com/api/badge/omdsh-dev/dsh-data-agent?metric=downloads" alt="dshfind downloads"></a>
  &nbsp;
  <img src="https://img.shields.io/github/stars/omdsh-dev/dsh-data-agent?style=flat-square" alt="Stars">
  &nbsp;
  <img src="https://img.shields.io/npm/v/@yejiming%2Fdsh-data-agent?style=flat-square&label=npm" alt="npm">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Intelligent Data & Business Analysis Assistant for DeepSeek Harness</strong><br>
  <em>Natural-Language Queries · Automatic SQL Execution · Smart Charts & Dashboards · AI Data Governance · Business Insights · Secure Local Read-Only</em>
</p>

<p align="center">

[Highlights](#product-highlights) · [Quick Start](#quick-start) · [Use Cases](#use-cases) · [Workbench & Reports](#workbench--reports) · [Supported Data Sources](#supported-data-sources) · [Security & Privacy](#security--privacy) · [FAQ](#faq) · [License](#license)

</p>

## Product Highlights

Tired of filing data requests, wrestling with complex SQL queries, exporting CSVs back and forth into Excel, and trying to decipher cryptic column abbreviations across hundreds of tables?

**DSH Data Agent brings data analysis back to business decision-making:**

- 💬 **Zero-Barrier Conversational Analysis**: Ask business questions in plain language (e.g., *"Compare channel conversion rates over the last 30 days"*). AI automatically understands business intent, discovers relevant schemas, writes and executes SQL, iterates on results, and delivers clear conclusions.
- 📊 **Smart Charts & Interactive Dashboards**: Say goodbye to plain text and raw tables. Automatically generate line charts, bar charts, pie charts, scatter plots, or multi-view dashboards, and export standalone offline HTML reports for effortless sharing.
- 🧠 **Deep Business Insights**: Go beyond raw metrics. The agent pinpoints anomaly drivers, detects sales drops, identifies high-value customer cohorts, and translates cold numbers into actionable business recommendations.
- 🏷️ **AI-Powered Metric & Schema Governance**: Automatically scans databases to generate intuitive business explanations for tables and fields. Supports human review and custom metric definitions, ensuring every query relies on unified, accurate business definitions.
- 🔒 **Local Security & Read-Only Protection**: Built-in support for read-only database accounts and read-only mode. All queries run locally with strict credential protection—your production data stays safe and confidential.
- 🖥️ **Modern Web & High-Efficiency Terminal**: Use the intuitive Web UI to configure connections and explore charts visually, or switch to the keyboard-first terminal interface (dsh-tui) for rapid command-line workflows.

<p align="center">
  <img src="assets/features.webp" alt="DSH Data Agent Features" width="100%">
</p>

## Quick Start

### 1. Prerequisites

- **DeepSeek Harness** (DSH runtime environment)
- Accessible database (local SQLite file or remote/cloud database)

### 2. Quick Install

Run the following command to install the plugin directly from npm:

```bash
# Install for Web UI (Recommended)
dsh plugin --profile web add @yejiming/dsh-data-agent

# Or install for Terminal UI (dsh-tui)
dsh plugin --profile dsh-tui add @yejiming/dsh-data-agent
```

### 3. Start Analyzing

#### Method 1: Web Interface (Recommended)
Start the Web console, create a new session, and select **"Data Mode"**:
```bash
dsh --profile web
```
1. On the New Session screen, click **Connection Settings** beside **Data Mode**; after the session opens, you can use the **Database icon** in the top-right of the composer. Fill in your connection details in the same workbench (supports connection testing);
2. Once connected, ask your business analysis question directly in the chat box;
3. Ask follow-up questions to drill down deeper based on preliminary conclusions.

#### Method 2: Terminal Interface (dsh-tui)
Ideal for keyboard-first and terminal users:
```bash
dsh --profile dsh-tui
```
Enter `/preset data-agent` to switch to Data Mode, and `/database connect` to connect your database and start asking questions.

## Use Cases

| Scenario | Prompt Example |
| :--- | :--- |
| 📈 **Sales & Revenue Review** | *"Analyze revenue and MoM growth by channel over the last 30 days, identify the product categories with the steepest decline, and explain the key drivers."* |
| 👥 **User Segmentation & RFM** | *"Perform RFM segmentation on members based on purchase frequency and average order value over the past 6 months, and report retention rates for each tier."* |
| 🛒 **Funnel & Conversion Analysis** | *"Calculate monthly user conversion rates from registration, search, and add-to-cart to checkout, and highlight the stage with the highest drop-off rate."* |
| 📦 **Inventory & Supply Chain** | *"Inspect SKUs with inventory turnover exceeding 60 days, and forecast stockout or overstock risks based on recent sales velocity."* |
| 📑 **Executive Weekly Summary** | *"Summarize last week's core metrics (GMV, active users, average order value) and write a concise briefing suitable for the management group chat."* |

## Workbench & Reports

### 1. All-in-One Database Workbench
The Web UI features an integrated database workbench with four core modules: **Connection Config**, **Schema Browser**, **Data Governance**, and **SQL Runner**, making it easy to inspect data assets at any time.

<p align="center">
  <img src="assets/tables.webp" alt="Database Workbench" width="90%">
</p>

### 2. AI-Assisted Data Governance
Open the "Data Governance" tab in the workbench, and AI will scan table schemas to generate clear business descriptions. Review, refine, and add custom metrics so team members never have to guess column meanings again.

<p align="center">
  <img src="assets/data-governance.webp" alt="AI Data Governance" width="90%">
</p>

### 3. Interactive Offline Analysis Reports
When an analysis benefits from visual presentation, the agent generates single charts or multi-metric dashboards and automatically saves standalone HTML reports under `analysis-reports/`. Includes interactive charts, KPI cards, and raw data tables—ready to open offline in any browser or share with colleagues.

<p align="center">
  <img src="assets/charts.webp" alt="Analysis Report Charts" width="90%">
</p>

## Supported Data Sources

DSH Data Agent supports a wide variety of relational databases, analytical data warehouses, and local files:

- 🐬 **Relational Databases**: MySQL, PostgreSQL, SQLite, Oracle, Microsoft SQL Server
- ⚡ **Analytical Warehouses / OLAP**: ClickHouse, Apache Doris, Apache Hive, Apache Impala
- 📁 **Local & Lightweight Data**: SQLite data files (zero-config, out-of-the-box)

## Security & Privacy

- 🛡️ **Strict Read-Only Protection**: Use a read-only database account and enable "Read-Only Mode" to prevent accidental data modification or deletion.
- 🔑 **Credential Isolation**: Database passwords are used strictly in the current runtime session, never written to plain-text logs, and never sent to external servers.
- 💻 **100% Local Execution**: Query execution and report generation happen entirely on your local machine, keeping business data private and secure.

## FAQ

<details>
<summary><b>Q: I don't know SQL at all. Can I still use this for data analysis?</b></summary>
Absolutely! DSH Data Agent is designed specifically for business professionals, marketers, and analysts without technical coding backgrounds. Simply describe what you want in plain language; AI will find the relevant tables, generate and execute precise SQL queries, and synthesize the results into business charts and actionable findings.
</details>

<details>
<summary><b>Q: Is there any risk of accidentally deleting or altering production data?</b></summary>
No. We strongly recommend using a read-only database account and enabling "Read-Only Mode". In read-only mode, any modifying or destructive statements (such as UPDATE, DELETE, DROP) are strictly blocked before execution.
</details>

<details>
<summary><b>Q: Our database column names are cryptic abbreviations. Can the AI understand them?</b></summary>
Yes. You can use the built-in "Data Governance" feature to let AI automatically scan schemas, comments, and relationships to generate plain business descriptions. You can also manually add company-specific terms and formulas (e.g., "Net GMV = Order GMV - Refund Amount"), which AI will reference in all future analyses.
</details>

<details>
<summary><b>Q: How do I share analysis reports with colleagues who don't use DSH?</b></summary>
Every generated report is saved locally as an independent <code>.html</code> file in the <code>analysis-reports/</code> directory. All styles, interactivity, and datasets are self-contained. You can send this file via email, Slack, Teams, or WeChat, and anyone can open and interact with it in any browser without installing extra software.
</details>

<details>
<summary><b>Q: Can I ask follow-up questions if I need deeper breakdowns or different chart formats?</b></summary>
Yes! Just like working with an in-house data analyst, you can continuously ask follow-ups in the same session (e.g., *"Break this down by region"*, *"Switch the bar chart to a pie chart"*, or *"Why did revenue drop in May?"*), and AI will iterate based on prior findings.
</details>

## License

This project is licensed under the [MIT License](LICENSE).

## Related Links

- [dshfind.com](https://dshfind.com): DeepSeek Harness plugin and ecosystem discovery community
- [dsh-web-ui](https://github.com/dsh-external/dsh-web-ui): Extensible Web UI for DeepSeek Harness
- [dsh-cc-tui](https://github.com/dsh-external/dsh-cc-tui): Keyboard-first terminal interface for DeepSeek Harness
- [platonai/Browser4](https://github.com/platonai/Browser4): AI-native browser engine for autonomous agents and large-scale web automation
