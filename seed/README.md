# dsh-data-agent demo 数据集（MySQL 8）

本目录提供一套**表结构复杂、字段丰富、数据量充足**的 MySQL 测试数据集，用于验证
dsh-data-agent 插件全链路（连接 / 库表浏览 / SQL 命令框 / sqlcmd / AI 对话探查）。
规划文档见 `docs/mysql-demo-plan.md`。

## 快速开始

```sh
# 1) 安装并启动 MySQL 8（macOS/Homebrew；其他平台请自行安装）
brew install mysql
brew services start mysql

# 2) 建库/建表/视图/触发器/存储过程（幂等可重跑）
mysql -uroot < seed/mysql_demo_schema.sql

# 3) 灌数（约 230 万行，14 秒；确定性种子，可重跑）
mysql -uroot < seed/mysql_demo_seed.sql

# 4) 验证探针
mysql -uroot dsh_data_agent_demo < seed/verify.sql
```

## 连接参数（插件测试用）

| 项 | 值 |
|---|---|
| type | `mysql` |
| host / port | `127.0.0.1` / `3306` |
| user | `dsh_demo` |
| password | `dsh_demo_pw` |
| database | `dsh_data_agent_demo` |

账号仅限 localhost + 该库的 `SELECT/INSERT/UPDATE/DELETE/CREATE/ALTER/INDEX/DROP`。

## 数据集概况

- **25 张基础表 + 2 视图**，7 组业务域：会员、商品供应链、采购、订单、物流、营销互动、行为审计。
- **约 230 万行**（灌数 14 秒）：核心大表 shipment_tracking 50 万、order_items 30 万、
  audit_logs 20 万、price_history 15 万、customer_coupons 15 万、inventory 12 万等。
- **复杂特性**：外键 ≥15、唯一索引 ≥20、复合索引 ≥19、CHECK ≥15、生成列 8、
  JSON 11、ENUM ≥25、SET、FULLTEXT（ngram）、空间列 POINT、RANGE 分区（audit_logs 按月）、
  视图 2、触发器 1（order_items → audit_logs 审计联动）、存储过程 1。

### 实际行数（seed=20260812）

| 表 | 行数 | 表 | 行数 |
|---|---|---|---|
| shipment_tracking | 500,000 | order_items | 300,000 |
| audit_logs | 200,000 | customer_coupons | 150,000 |
| price_history | 150,000 | inventory | 120,000 |
| orders | 100,000 | shipments | 100,000 |
| order_payments | 108,000 | customer_addresses | 100,001 |
| cart_items | 75,000 | customer_contacts | 75,000 |
| product_reviews | 60,000 | product_skus | 60,000 |
| customers | 50,000 | refund_items | 60,000 |
| refunds | 30,000 | products | 20,000 |
| purchase_order_items | 39,115 | purchase_orders | 8,000 |
| marketing_campaigns | 2,000 | categories | 300 |
| suppliers | 500 | coupons | 500 |
| warehouses | 30 | | |

## 确定性

`sp_seed_demo(seed)` 的行数与分布由 **id 取模** 决定（跨版本可复现）；`RAND()`
仅用于名称/价格等非关键字段（同一 MySQL 版本内可复现）。相同 seed 重灌结果一致
（已用 orders 前 100 行样本验证）。换一个种子即可得到不同面貌的数据。

## 验证矩阵（插件全链路，已实测通过）

| 功能面 | 结果 |
|---|---|
| `POST /connect`（dsh_demo） | `{ok:true, tables:[25 表 + 2 视图]}` |
| `GET /schemas` | 含 `dsh_data_agent_demo`（+ information_schema/performance_schema） |
| `GET /tables?schema=dsh_data_agent_demo` | 27 行（25 表 + 2 视图） |
| `GET /describe ... table=orders` | 29 列（ENUM/DECIMAL/生成列/JSON/DATETIME(3) 解析正确） |
| `POST /query` | COUNT / 多表 JOIN 聚合 / FULLTEXT（ngram）/ JSON 提取 / ST_Distance 空间 / 分区裁剪 EXPLAIN 全部正确 |
| sqlcmd AI 会话 | SHOW TABLES → DESCRIBE → 写 `order_stats.sql`（write）→ 近 30 天统计 → information_schema 列数，turn completed |
| 负面 | 错误密码 → `{ok:false, error: 1045 Access denied...}`；不存在表 → 元数据查询失败报错 |

## 重置 / 清理

```sh
# 全量重置（TRUNCATE + 重新灌数，无需 DROP）
mysql -uroot < seed/mysql_demo_schema.sql
mysql -uroot < seed/mysql_demo_seed.sql

# 完全清理
brew services stop mysql
mysql -uroot -e "DROP DATABASE IF EXISTS dsh_data_agent_demo; DROP USER IF EXISTS 'dsh_demo'@'localhost';"
```

## 注意事项

- **FULLTEXT**：products.name 使用 ngram 分词器（中文检索）；批量灌数后存储过程内已
  执行 `OPTIMIZE TABLE products` 强制重建索引（InnoDB 延迟批量更新的已知行为）。
- **audit_logs**：18 万条由 order_items 触发器写入（order_items 的 60%）、2 万条直插，合计 20 万；
  分区表无外键（MySQL 限制），资源引用为逻辑 ID。
- **schema 演进**：脚本 `CREATE TABLE IF NOT EXISTS`，对已存在的旧表不会应用 DDL
  变更——需要演进时先 DROP DATABASE 再重跑（seed 会全量重建数据）。
- **MySQL ≥ 8.0.16** 要求（CHECK/生成列/函数索引/分区）；已在 MySQL 9.7.1 验证。
