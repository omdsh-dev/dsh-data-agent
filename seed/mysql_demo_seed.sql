-- ============================================================================
-- dsh-data-agent demo dataset — seed runner
-- 调用 sp_seed_demo 灌数并输出 25 表行数汇总（确定性：固定种子）
-- 用法: mysql -uroot < seed/mysql_demo_schema.sql && mysql -uroot < seed/mysql_demo_seed.sql
-- ============================================================================

USE dsh_data_agent_demo;

CALL sp_seed_demo(20260812);

SELECT 'customers' AS tbl, COUNT(*) AS rows_cnt FROM customers
UNION ALL SELECT 'customer_addresses', COUNT(*) FROM customer_addresses
UNION ALL SELECT 'customer_contacts', COUNT(*) FROM customer_contacts
UNION ALL SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'product_skus', COUNT(*) FROM product_skus
UNION ALL SELECT 'suppliers', COUNT(*) FROM suppliers
UNION ALL SELECT 'warehouses', COUNT(*) FROM warehouses
UNION ALL SELECT 'inventory', COUNT(*) FROM inventory
UNION ALL SELECT 'price_history', COUNT(*) FROM price_history
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders
UNION ALL SELECT 'purchase_order_items', COUNT(*) FROM purchase_order_items
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'order_payments', COUNT(*) FROM order_payments
UNION ALL SELECT 'refunds', COUNT(*) FROM refunds
UNION ALL SELECT 'refund_items', COUNT(*) FROM refund_items
UNION ALL SELECT 'shipments', COUNT(*) FROM shipments
UNION ALL SELECT 'shipment_tracking', COUNT(*) FROM shipment_tracking
UNION ALL SELECT 'coupons', COUNT(*) FROM coupons
UNION ALL SELECT 'customer_coupons', COUNT(*) FROM customer_coupons
UNION ALL SELECT 'marketing_campaigns', COUNT(*) FROM marketing_campaigns
UNION ALL SELECT 'product_reviews', COUNT(*) FROM product_reviews
UNION ALL SELECT 'cart_items', COUNT(*) FROM cart_items
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs;
