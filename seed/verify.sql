-- ============================================================================
-- dsh-data-agent demo dataset — verification probes
-- 用法: mysql -uroot dsh_data_agent_demo < seed/verify.sql
-- ============================================================================

-- 1) 分区信息（audit_logs 应为 37 个分区）
SELECT PARTITION_NAME, PARTITION_DESCRIPTION
FROM information_schema.PARTITIONS
WHERE TABLE_SCHEMA = 'dsh_data_agent_demo' AND TABLE_NAME = 'audit_logs'
ORDER BY PARTITION_ORDINAL_POSITION LIMIT 5;

-- 2) 近 30 天订单（时间分布探针）
SELECT COUNT(*) AS orders_last_30d
FROM orders
WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY);

-- 3) 客单价 Top10（聚合查询探针）
SELECT c.customer_no, c.name, ROUND(AVG(o.pay_amount), 2) AS avg_order
FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'completed'
GROUP BY c.customer_no, c.name
ORDER BY avg_order DESC
LIMIT 10;

-- 4) FULLTEXT 探针
SELECT id, name, list_price
FROM products
WHERE MATCH(name) AGAINST ('智能手表' IN BOOLEAN MODE)
LIMIT 5;

-- 5) JSON 提取探针
SELECT id, JSON_UNQUOTE(JSON_EXTRACT(specs, '$.颜色[0]')) AS first_color
FROM products
WHERE spec_type = 'multi' AND specs IS NOT NULL
LIMIT 5;

-- 6) 空间查询探针（仓库 200 公里半径）
SELECT w.id, w.name,
       ROUND(ST_Distance_Sphere(w.location, ST_SRID(POINT(113.26, 23.13), 4326)) / 1000, 1) AS km
FROM warehouses w
WHERE ST_Distance_Sphere(w.location, ST_SRID(POINT(113.26, 23.13), 4326)) <= 200000
ORDER BY km;

-- 7) 分区裁剪 EXPLAIN
EXPLAIN SELECT COUNT(*) FROM audit_logs WHERE created_at >= '2024-01-01' AND created_at < '2024-03-01';

-- 8) 生成列抽查
SELECT id, quantity, locked_quantity, available_quantity FROM inventory LIMIT 5;
SELECT id, items_total, discount_amount, shipping_fee, coupon_deduct, pay_amount FROM orders LIMIT 5;

-- 9) 视图抽查
SELECT COUNT(*) AS summary_rows FROM v_order_summary;
SELECT COUNT(*) AS stock_rows FROM v_sku_stock;

-- 10) 审计来源分布（触发器 vs 直插）
SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.source')) AS source, COUNT(*) AS cnt
FROM audit_logs
GROUP BY source;
