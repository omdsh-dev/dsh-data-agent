-- ============================================================================
-- dsh-data-agent demo dataset — MySQL 8 schema
-- 依据 docs/mysql-demo-plan.md §4（25 表 / 7 组业务域 / 复杂特性全覆盖）
-- 幂等可重跑：CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS
-- 用法: mysql -uroot < seed/mysql_demo_schema.sql
-- ============================================================================

SET NAMES utf8mb4;

-- ── 库与账号 ────────────────────────────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS dsh_data_agent_demo
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'dsh_demo'@'localhost' IDENTIFIED BY 'dsh_demo_pw';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP
  ON dsh_data_agent_demo.* TO 'dsh_demo'@'localhost';
FLUSH PRIVILEGES;

USE dsh_data_agent_demo;

-- ── A 组 · 会员与地址 ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_no    CHAR(16)        NOT NULL,
  email          VARCHAR(128)    NULL,
  phone          VARCHAR(20)     NOT NULL,
  name           VARCHAR(64)     NOT NULL,
  gender         ENUM('male','female','other') NOT NULL DEFAULT 'other',
  birth_date     DATE            NOT NULL,
  age            TINYINT UNSIGNED GENERATED ALWAYS AS (2026 - YEAR(birth_date)) STORED,
  level          ENUM('normal','silver','gold','platinum') NOT NULL DEFAULT 'normal',
  points         INT UNSIGNED    NOT NULL DEFAULT 0,
  balance        DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  region_code    CHAR(6)         NOT NULL,
  is_verified    TINYINT(1)      NOT NULL DEFAULT 0,
  status         ENUM('active','frozen','closed') NOT NULL DEFAULT 'active',
  attributes     JSON            NULL,
  source_channel ENUM('app','web','mini','offline','invite') NOT NULL DEFAULT 'app',
  registered_at  DATETIME(3)     NOT NULL,
  last_login_at  DATETIME        NULL,
  created_at     DATETIME(3)     NOT NULL,
  updated_at     DATETIME(3)     NOT NULL,
  version        INT UNSIGNED    NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_no (customer_no),
  UNIQUE KEY uq_email (email),
  KEY idx_phone_status (phone, status),
  KEY idx_level_created (level, created_at),
  KEY idx_region_level (region_code, level),
  CONSTRAINT chk_points CHECK (points >= 0),
  CONSTRAINT chk_balance CHECK (balance >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id    BIGINT UNSIGNED NOT NULL,
  tag            ENUM('home','company','school','other') NOT NULL DEFAULT 'home',
  receiver_name  VARCHAR(64)     NOT NULL,
  receiver_phone VARCHAR(20)     NOT NULL,
  province       VARCHAR(32)     NOT NULL,
  city           VARCHAR(32)     NOT NULL,
  district       VARCHAR(32)     NOT NULL,
  address_line   VARCHAR(255)    NOT NULL,
  postal_code    CHAR(6)         NOT NULL,
  lat            DECIMAL(10,7)   NOT NULL,
  lng            DECIMAL(10,7)   NOT NULL,
  is_default     TINYINT(1)      NOT NULL DEFAULT 0,
  is_deleted     TINYINT(1)      NOT NULL DEFAULT 0,
  created_at     DATETIME(3)     NOT NULL,
  updated_at     DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_customer (customer_id),
  -- 每客至多一个默认地址（函数索引）
  UNIQUE KEY uq_customer_default ((IF(is_default, customer_id, NULL))),
  CONSTRAINT fk_addr_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_contacts (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id    BIGINT UNSIGNED NOT NULL,
  contact_type   ENUM('phone','email','wechat','alipay','emergency') NOT NULL,
  contact_value  VARCHAR(128)    NOT NULL,
  is_primary     TINYINT(1)      NOT NULL DEFAULT 0,
  status         ENUM('active','inactive','invalid') NOT NULL DEFAULT 'active',
  verified_at    TIMESTAMP       NULL,
  source         VARCHAR(32)     NULL,
  remark         VARCHAR(255)    NULL,
  created_at     DATETIME(3)     NOT NULL,
  updated_at     DATETIME(3)     NOT NULL,
  version        INT UNSIGNED    NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_type (customer_id, contact_type),
  CONSTRAINT fk_contact_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB;

-- ── B 组 · 商品与供应链 ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  parent_id     BIGINT UNSIGNED NULL,
  name          VARCHAR(64)     NOT NULL,
  code          VARCHAR(32)     NOT NULL,
  path          VARCHAR(255)    NOT NULL,
  level         TINYINT UNSIGNED GENERATED ALWAYS AS (CHAR_LENGTH(path) - CHAR_LENGTH(REPLACE(path,'/','')) - 1) STORED,
  sort_order    SMALLINT        NOT NULL DEFAULT 0,
  icon_url      VARCHAR(255)    NULL,
  is_leaf       TINYINT(1)      NOT NULL DEFAULT 0,
  status        ENUM('enabled','disabled') NOT NULL DEFAULT 'enabled',
  description   VARCHAR(255)    NULL,
  seo_title     VARCHAR(255)    NULL,
  seo_keywords  VARCHAR(255)    NULL,
  created_at    DATETIME(3)     NOT NULL,
  updated_at    DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cat_code (code),
  KEY idx_parent (parent_id),
  CONSTRAINT fk_cat_parent FOREIGN KEY (parent_id) REFERENCES categories (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id   BIGINT UNSIGNED NOT NULL,
  product_no    CHAR(20)        NOT NULL,
  name          VARCHAR(200)    NOT NULL,
  subtitle      VARCHAR(255)    NULL,
  brand         VARCHAR(64)     NOT NULL,
  status        ENUM('draft','on_sale','off_sale','deleted') NOT NULL DEFAULT 'draft',
  list_price    DECIMAL(12,2)   NOT NULL,
  cost_price    DECIMAL(12,2)   NOT NULL,
  spec_type     ENUM('single','multi') NOT NULL DEFAULT 'single',
  specs         JSON            NULL,
  main_image_url VARCHAR(255)   NULL,
  images        JSON            NULL,
  sales_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  rating        DECIMAL(3,2)    NOT NULL DEFAULT 5.00,
  review_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  is_featured   TINYINT(1)      NOT NULL DEFAULT 0,
  is_multi_sku  TINYINT(1)      NOT NULL DEFAULT 0,
  launched_at   DATETIME        NULL,
  expired_at    DATETIME        NULL,
  created_at    DATETIME(3)     NOT NULL,
  updated_at    DATETIME(3)     NOT NULL,
  version       INT UNSIGNED    NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_no (product_no),
  FULLTEXT KEY ft_name (name) WITH PARSER ngram,
  KEY idx_category_status (category_id, status),
  KEY idx_brand_status (brand, status),
  CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories (id),
  CONSTRAINT chk_list_price CHECK (list_price >= 0),
  CONSTRAINT chk_cost_price CHECK (cost_price >= 0),
  CONSTRAINT chk_product_rating CHECK (rating BETWEEN 0 AND 5)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_skus (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id    BIGINT UNSIGNED NOT NULL,
  sku_code      VARCHAR(64)     NOT NULL,
  barcode       VARCHAR(32)     NOT NULL,
  name          VARCHAR(200)    NOT NULL,
  spec_values   JSON            NULL,
  list_price    DECIMAL(12,2)   NOT NULL,
  sale_price    DECIMAL(12,2)   NOT NULL,
  cost_price    DECIMAL(12,2)   NOT NULL,
  weight_g      INT UNSIGNED    NOT NULL DEFAULT 0,
  volume_cm3    INT UNSIGNED    NOT NULL DEFAULT 0,
  status        ENUM('on_sale','off_sale') NOT NULL DEFAULT 'on_sale',
  is_default    TINYINT(1)      NOT NULL DEFAULT 0,
  stock_warn_threshold INT UNSIGNED NOT NULL DEFAULT 10,
  created_at    DATETIME(3)     NOT NULL,
  updated_at    DATETIME(3)     NOT NULL,
  version       INT UNSIGNED    NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_sku (product_id, sku_code),
  UNIQUE KEY uq_barcode (barcode),
  CONSTRAINT fk_sku_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_sku_list CHECK (list_price >= 0),
  CONSTRAINT chk_sku_sale CHECK (sale_price >= 0),
  CONSTRAINT chk_sku_cost CHECK (cost_price >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS suppliers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_no    CHAR(16)        NOT NULL,
  name           VARCHAR(128)    NOT NULL,
  contact_name   VARCHAR(64)     NOT NULL,
  contact_phone  VARCHAR(20)     NOT NULL,
  contact_email  VARCHAR(128)    NULL,
  region_code    CHAR(6)         NOT NULL,
  address        VARCHAR(255)    NULL,
  rating         DECIMAL(3,2)    NOT NULL DEFAULT 4.00,
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  payment_terms  ENUM('cod','net30','net60','prepaid') NOT NULL DEFAULT 'net30',
  lead_time_days SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  remark         VARCHAR(255)    NULL,
  created_at     DATETIME(3)     NOT NULL,
  updated_at     DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supplier_no (supplier_no),
  UNIQUE KEY uq_supplier_name (name),
  CONSTRAINT chk_supplier_rating CHECK (rating BETWEEN 0 AND 5)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS warehouses (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  warehouse_no   CHAR(12)        NOT NULL,
  name           VARCHAR(64)     NOT NULL,
  region_code    CHAR(6)         NOT NULL,
  address        VARCHAR(255)    NULL,
  manager_name   VARCHAR(64)     NOT NULL,
  manager_phone  VARCHAR(20)     NOT NULL,
  location       POINT SRID 4326 NOT NULL,
  capacity       INT UNSIGNED    NOT NULL DEFAULT 0,
  used_capacity  INT UNSIGNED    NOT NULL DEFAULT 0,
  is_cold_chain  TINYINT(1)      NOT NULL DEFAULT 0,
  status         ENUM('active','maintenance','closed') NOT NULL DEFAULT 'active',
  created_at     DATETIME(3)     NOT NULL,
  updated_at     DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_warehouse_no (warehouse_no),
  KEY idx_region_status (region_code, status),
  SPATIAL KEY sp_location (location),
  CONSTRAINT chk_used_capacity CHECK (used_capacity <= capacity)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sku_id             BIGINT UNSIGNED NOT NULL,
  warehouse_id       BIGINT UNSIGNED NOT NULL,
  quantity           INT             NOT NULL DEFAULT 0,
  locked_quantity    INT             NOT NULL DEFAULT 0,
  available_quantity INT GENERATED ALWAYS AS (quantity - locked_quantity) STORED,
  safety_stock       INT UNSIGNED    NOT NULL DEFAULT 0,
  last_inbound_at    DATETIME        NULL,
  last_outbound_at   DATETIME        NULL,
  inbound_count      INT UNSIGNED    NOT NULL DEFAULT 0,
  outbound_count     INT UNSIGNED    NOT NULL DEFAULT 0,
  status             ENUM('normal','frozen','damaged') NOT NULL DEFAULT 'normal',
  version            INT UNSIGNED    NOT NULL DEFAULT 1,
  created_at         DATETIME(3)     NOT NULL,
  updated_at         DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sku_warehouse (sku_id, warehouse_id),
  KEY idx_warehouse_qty (warehouse_id, quantity),
  CONSTRAINT fk_inv_sku FOREIGN KEY (sku_id) REFERENCES product_skus (id),
  CONSTRAINT fk_inv_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT chk_quantity CHECK (quantity >= 0),
  CONSTRAINT chk_locked CHECK (locked_quantity >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS price_history (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sku_id        BIGINT UNSIGNED NOT NULL,
  old_price     DECIMAL(12,2)   NOT NULL,
  new_price     DECIMAL(12,2)   NOT NULL,
  change_reason ENUM('promotion','cost','clearance','manual','competitor') NOT NULL,
  operator_type ENUM('system','admin','merchant') NOT NULL DEFAULT 'system',
  operator_id   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  effective_at  DATETIME(3)     NOT NULL,
  expires_at    DATETIME        NULL,
  remark        VARCHAR(255)    NULL,
  created_at    DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sku_effective (sku_id, effective_at),
  CONSTRAINT fk_price_sku FOREIGN KEY (sku_id) REFERENCES product_skus (id),
  CONSTRAINT chk_old_price CHECK (old_price >= 0),
  CONSTRAINT chk_new_price CHECK (new_price >= 0)
) ENGINE=InnoDB;

-- ── C 组 · 采购 ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_orders (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  po_no          CHAR(20)        NOT NULL,
  supplier_id    BIGINT UNSIGNED NOT NULL,
  warehouse_id   BIGINT UNSIGNED NOT NULL,
  status         ENUM('draft','confirmed','partial','received','cancelled') NOT NULL DEFAULT 'draft',
  total_amount   DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  item_count     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tax_rate       DECIMAL(5,2)    NOT NULL DEFAULT 13.00,
  tax_amount     DECIMAL(12,2)   GENERATED ALWAYS AS (ROUND(total_amount * tax_rate / 100, 2)) STORED,
  expected_at    DATE            NULL,
  confirmed_at   DATETIME        NULL,
  received_at    DATETIME        NULL,
  creator_id     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  approver_id    BIGINT UNSIGNED NULL,
  remark         VARCHAR(255)    NULL,
  created_at     DATETIME(3)     NOT NULL,
  updated_at     DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_po_no (po_no),
  KEY idx_supplier_status (supplier_id, status),
  KEY idx_warehouse (warehouse_id),
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_po_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT chk_po_amount CHECK (total_amount >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  purchase_order_id BIGINT UNSIGNED NOT NULL,
  sku_id            BIGINT UNSIGNED NOT NULL,
  quantity          INT UNSIGNED    NOT NULL,
  unit_cost         DECIMAL(12,2)   NOT NULL,
  total_cost        DECIMAL(12,2)   GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  received_qty      INT UNSIGNED    NOT NULL DEFAULT 0,
  qualified_qty     INT UNSIGNED    NOT NULL DEFAULT 0,
  defect_qty        INT UNSIGNED    NOT NULL DEFAULT 0,
  status            ENUM('pending','partial','done') NOT NULL DEFAULT 'pending',
  remark            VARCHAR(255)    NULL,
  created_at        DATETIME(3)     NOT NULL,
  updated_at        DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_po_sku (purchase_order_id, sku_id),
  KEY idx_poitem_sku (sku_id),
  CONSTRAINT fk_poitem_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id),
  CONSTRAINT fk_poitem_sku FOREIGN KEY (sku_id) REFERENCES product_skus (id),
  CONSTRAINT chk_poitem_qty CHECK (quantity > 0),
  CONSTRAINT chk_poitem_cost CHECK (unit_cost >= 0)
) ENGINE=InnoDB;

-- ── D 组 · 订单域（核心）────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no          CHAR(20)        NOT NULL,
  customer_id       BIGINT UNSIGNED NOT NULL,
  customer_address_id BIGINT UNSIGNED NOT NULL,
  coupon_id         BIGINT UNSIGNED NULL,
  status            ENUM('pending','paid','shipped','completed','cancelled','refunded') NOT NULL DEFAULT 'pending',
  pay_method        ENUM('wechat','alipay','card','balance','cod') NOT NULL DEFAULT 'wechat',
  item_count        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  items_total       DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  discount_amount   DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  shipping_fee      DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  coupon_deduct     DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  points_deduct     INT UNSIGNED    NOT NULL DEFAULT 0,
  pay_amount        DECIMAL(12,2)   GENERATED ALWAYS AS (items_total - discount_amount - coupon_deduct + shipping_fee) STORED,
  gift_points       INT UNSIGNED    NOT NULL DEFAULT 0,
  receiver_name     VARCHAR(64)     NOT NULL,
  receiver_phone    VARCHAR(20)     NOT NULL,
  receiver_address  VARCHAR(255)    NOT NULL,
  region_code       CHAR(6)         NOT NULL,
  channel           ENUM('app','web','mini','offline') NOT NULL DEFAULT 'app',
  is_invoice        TINYINT(1)      NOT NULL DEFAULT 0,
  remark            VARCHAR(255)    NULL,
  created_at        DATETIME(3)     NOT NULL,
  paid_at           DATETIME        NULL,
  shipped_at        DATETIME        NULL,
  completed_at      DATETIME        NULL,
  cancelled_at      DATETIME        NULL,
  version           INT UNSIGNED    NOT NULL DEFAULT 1,
  updated_at        DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_no (order_no),
  KEY idx_status_created (status, created_at),
  KEY idx_customer_created (customer_id, created_at),
  KEY idx_region_created (region_code, created_at),
  KEY idx_coupon (coupon_id),
  CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_order_address FOREIGN KEY (customer_address_id) REFERENCES customer_addresses (id),
  -- fk_order_coupon 在 coupons 建表后以 ALTER 补充（避免前向引用）
  CONSTRAINT chk_items_total CHECK (items_total >= 0),
  CONSTRAINT chk_discount CHECK (discount_amount >= 0),
  CONSTRAINT chk_shipping CHECK (shipping_fee >= 0),
  CONSTRAINT chk_coupon_deduct CHECK (coupon_deduct >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id      BIGINT UNSIGNED NOT NULL,
  sku_id        BIGINT UNSIGNED NOT NULL,
  product_name  VARCHAR(200)    NOT NULL,
  sku_name      VARCHAR(200)    NOT NULL,
  spec_values   JSON            NULL,
  unit_price    DECIMAL(12,2)   NOT NULL,
  quantity      INT UNSIGNED    NOT NULL,
  line_total    DECIMAL(12,2)   GENERATED ALWAYS AS (unit_price * quantity) STORED,
  discount_share DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  gift_points   INT UNSIGNED    NOT NULL DEFAULT 0,
  is_reviewed   TINYINT(1)      NOT NULL DEFAULT 0,
  status        ENUM('normal','refunded','partially_refunded') NOT NULL DEFAULT 'normal',
  created_at    DATETIME(3)     NOT NULL,
  updated_at    DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_sku (order_id, sku_id),
  KEY idx_sku_created (sku_id, created_at),
  CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_item_sku FOREIGN KEY (sku_id) REFERENCES product_skus (id),
  CONSTRAINT chk_item_price CHECK (unit_price >= 0),
  CONSTRAINT chk_item_qty CHECK (quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_payments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_no    CHAR(24)        NOT NULL,
  order_id      BIGINT UNSIGNED NOT NULL,
  channel       ENUM('wechat','alipay','card','balance') NOT NULL,
  amount        DECIMAL(12,2)   NOT NULL,
  status        ENUM('pending','success','failed','refunded') NOT NULL DEFAULT 'pending',
  payer_account VARCHAR(128)    NULL,
  trade_no      VARCHAR(64)     NULL,
  currency      CHAR(3)         NOT NULL DEFAULT 'CNY',
  fee           DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  paid_at       DATETIME(3)     NULL,
  notify_url    VARCHAR(255)    NULL,
  notify_count  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  callback_data JSON            NULL,
  remark        VARCHAR(255)    NULL,
  created_at    DATETIME(3)     NOT NULL,
  updated_at    DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_no (payment_no),
  KEY idx_order_paid (order_id, paid_at),
  CONSTRAINT fk_pay_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT chk_pay_amount CHECK (amount > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refunds (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  refund_no     CHAR(20)        NOT NULL,
  order_id      BIGINT UNSIGNED NOT NULL,
  customer_id   BIGINT UNSIGNED NOT NULL,
  reason_type   ENUM('quality','not_as_described','logistics','no_reason','other') NOT NULL,
  reason_detail VARCHAR(255)    NULL,
  amount        DECIMAL(12,2)   NOT NULL,
  status        ENUM('applied','auditing','approved','rejected','refunding','done') NOT NULL DEFAULT 'applied',
  channel       ENUM('original','balance') NOT NULL DEFAULT 'original',
  apply_source  ENUM('customer','merchant','system') NOT NULL DEFAULT 'customer',
  applied_at    DATETIME        NOT NULL,
  audited_at    DATETIME        NULL,
  refunded_at   DATETIME        NULL,
  auditor_id    BIGINT UNSIGNED NULL,
  images        JSON            NULL,
  remark        VARCHAR(255)    NULL,
  created_at    DATETIME(3)     NOT NULL,
  updated_at    DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refund_no (refund_no),
  KEY idx_order_status (order_id, status),
  KEY idx_customer (customer_id),
  CONSTRAINT fk_refund_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_refund_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT chk_refund_amount CHECK (amount >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refund_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  refund_id     BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL,
  quantity      INT UNSIGNED    NOT NULL,
  unit_amount   DECIMAL(12,2)   NOT NULL,
  amount        DECIMAL(12,2)   GENERATED ALWAYS AS (quantity * unit_amount) STORED,
  reason        VARCHAR(255)    NULL,
  is_include_shipping TINYINT(1) NOT NULL DEFAULT 0,
  status        ENUM('pending','done') NOT NULL DEFAULT 'pending',
  created_at    DATETIME(3)     NOT NULL,
  updated_at    DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refund_item (refund_id, order_item_id),
  KEY idx_ritem_oi (order_item_id),
  CONSTRAINT fk_ritem_refund FOREIGN KEY (refund_id) REFERENCES refunds (id),
  CONSTRAINT fk_ritem_orderitem FOREIGN KEY (order_item_id) REFERENCES order_items (id),
  CONSTRAINT chk_ritem_qty CHECK (quantity > 0),
  CONSTRAINT chk_ritem_amount CHECK (unit_amount >= 0)
) ENGINE=InnoDB;

-- ── E 组 · 物流 ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shipments (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shipment_no      CHAR(20)        NOT NULL,
  tracking_no      VARCHAR(32)     NOT NULL,
  order_id         BIGINT UNSIGNED NOT NULL,
  warehouse_id     BIGINT UNSIGNED NOT NULL,
  logistics_company ENUM('sf','zto','yto','jd','other') NOT NULL DEFAULT 'sf',
  carrier_code     VARCHAR(16)     NULL,
  status           ENUM('pending','picked','shipped','in_transit','delivered','signed','exception') NOT NULL DEFAULT 'pending',
  receiver_name    VARCHAR(64)     NOT NULL,
  receiver_phone   VARCHAR(20)     NOT NULL,
  receiver_address VARCHAR(255)    NOT NULL,
  item_count       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  weight_g         INT UNSIGNED    NOT NULL DEFAULT 0,
  fee              DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  is_signed        TINYINT(1)      NOT NULL DEFAULT 0,
  shipped_at       DATETIME        NULL,
  delivered_at     DATETIME        NULL,
  signed_at        DATETIME        NULL,
  remark           VARCHAR(255)    NULL,
  created_at       DATETIME(3)     NOT NULL,
  updated_at       DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shipment_no (shipment_no),
  UNIQUE KEY uq_tracking_no (tracking_no),
  KEY idx_order (order_id),
  KEY idx_status_shipped (status, shipped_at),
  KEY idx_warehouse (warehouse_id),
  CONSTRAINT fk_ship_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_ship_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT chk_ship_fee CHECK (fee >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shipment_tracking (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shipment_id  BIGINT UNSIGNED NOT NULL,
  sort_order   INT UNSIGNED    NOT NULL,
  tracked_at   DATETIME(3)     NOT NULL,
  status       ENUM('picked','shipped','in_transit','out_for_delivery','delivered','signed','exception') NOT NULL,
  node_code    VARCHAR(16)     NULL,
  node_name    VARCHAR(64)     NULL,
  city         VARCHAR(32)     NULL,
  description  VARCHAR(255)    NULL,
  location_desc VARCHAR(255)   NULL,
  created_at   DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_shipment_tracked (shipment_id, tracked_at),
  CONSTRAINT fk_track_shipment FOREIGN KEY (shipment_id) REFERENCES shipments (id),
  CONSTRAINT chk_sort_order CHECK (sort_order >= 0)
) ENGINE=InnoDB;

-- ── F 组 · 营销与互动 ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coupons (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  coupon_no       CHAR(16)        NOT NULL,
  name            VARCHAR(64)     NOT NULL,
  type            ENUM('amount','rate','shipping') NOT NULL DEFAULT 'amount',
  discount_amount DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  discount_rate   DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  min_spend       DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  max_discount    DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  total_qty       INT UNSIGNED    NOT NULL DEFAULT 0,
  issued_qty      INT UNSIGNED    NOT NULL DEFAULT 0,
  used_qty        INT UNSIGNED    NOT NULL DEFAULT 0,
  valid_from      DATETIME        NOT NULL,
  valid_until     DATETIME        NOT NULL,
  per_user_limit  SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  status          ENUM('draft','active','expired','disabled') NOT NULL DEFAULT 'draft',
  scope           ENUM('all','category','product') NOT NULL DEFAULT 'all',
  created_at      DATETIME(3)     NOT NULL,
  updated_at      DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_coupon_no (coupon_no),
  KEY idx_status_valid (status, valid_until),
  CONSTRAINT chk_coupon_amount CHECK (discount_amount >= 0),
  CONSTRAINT chk_coupon_rate CHECK (discount_rate BETWEEN 0 AND 100),
  CONSTRAINT chk_coupon_min CHECK (min_spend >= 0)
) ENGINE=InnoDB;

-- orders 的优惠券外键（coupons 现已存在）；用存储过程包裹实现幂等
DELIMITER $$
CREATE PROCEDURE _ensure_order_coupon_fk()
BEGIN
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
  ALTER TABLE orders ADD CONSTRAINT fk_order_coupon FOREIGN KEY (coupon_id) REFERENCES coupons (id);
END$$
DELIMITER ;
CALL _ensure_order_coupon_fk();
DROP PROCEDURE _ensure_order_coupon_fk;

CREATE TABLE IF NOT EXISTS customer_coupons (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id   BIGINT UNSIGNED NOT NULL,
  coupon_id     BIGINT UNSIGNED NOT NULL,
  code          CHAR(20)        NOT NULL,
  status        ENUM('unused','used','expired','refunded') NOT NULL DEFAULT 'unused',
  received_at   DATETIME(3)     NOT NULL,
  used_at       DATETIME        NULL,
  used_order_id BIGINT UNSIGNED NULL,
  expires_at    DATETIME        NOT NULL,
  source        ENUM('campaign','register','birthday','manual') NOT NULL DEFAULT 'campaign',
  batch_no      VARCHAR(32)     NULL,
  created_at    DATETIME(3)     NOT NULL,
  updated_at    DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_coupon (customer_id, coupon_id),
  UNIQUE KEY uq_coupon_code (code),
  KEY idx_status_expires (status, expires_at),
  CONSTRAINT fk_cc_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_cc_coupon FOREIGN KEY (coupon_id) REFERENCES coupons (id),
  CONSTRAINT fk_cc_order FOREIGN KEY (used_order_id) REFERENCES orders (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_no     CHAR(16)        NOT NULL,
  name            VARCHAR(128)    NOT NULL,
  channels        SET('app','web','mini','sms','offline') NOT NULL DEFAULT 'app',
  status          ENUM('draft','running','paused','ended') NOT NULL DEFAULT 'draft',
  budget          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  spent           DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  start_at        DATETIME        NOT NULL,
  end_at          DATETIME        NOT NULL,
  target_user     ENUM('all','new','returning','level_above') NOT NULL DEFAULT 'all',
  discount_policy JSON            NULL,
  created_by      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  approved_by     BIGINT UNSIGNED NULL,
  remark          VARCHAR(255)    NULL,
  created_at      DATETIME(3)     NOT NULL,
  updated_at      DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_no (campaign_no),
  KEY idx_status_started (status, start_at),
  CONSTRAINT chk_campaign_budget CHECK (budget >= 0),
  CONSTRAINT chk_campaign_spent CHECK (spent >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_reviews (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id          BIGINT UNSIGNED NOT NULL,
  sku_id               BIGINT UNSIGNED NOT NULL,
  order_id             BIGINT UNSIGNED NULL,
  rating               TINYINT UNSIGNED NOT NULL,
  content              TEXT            NULL,
  images               JSON            NULL,
  is_anonymous         TINYINT(1)      NOT NULL DEFAULT 0,
  is_verified_purchase TINYINT(1)      NOT NULL DEFAULT 0,
  helpful_count        INT UNSIGNED    NOT NULL DEFAULT 0,
  reply_content        VARCHAR(500)    NULL,
  reply_at             DATETIME        NULL,
  status               ENUM('visible','hidden','deleted') NOT NULL DEFAULT 'visible',
  created_at           DATETIME(3)     NOT NULL,
  updated_at           DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_review_customer_sku (customer_id, sku_id),
  KEY idx_review_sku_rating (sku_id, rating),
  CONSTRAINT fk_review_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_review_sku FOREIGN KEY (sku_id) REFERENCES product_skus (id),
  CONSTRAINT fk_review_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- ── G 组 · 行为与审计 ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cart_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  sku_id      BIGINT UNSIGNED NOT NULL,
  quantity    INT UNSIGNED    NOT NULL,
  selected    TINYINT(1)      NOT NULL DEFAULT 1,
  added_at    DATETIME(3)     NOT NULL,
  source      ENUM('detail','recommend','search','campaign') NOT NULL DEFAULT 'detail',
  channel     ENUM('app','web','mini') NOT NULL DEFAULT 'app',
  is_deleted  TINYINT(1)      NOT NULL DEFAULT 0,
  remark      VARCHAR(255)    NULL,
  created_at  DATETIME(3)     NOT NULL,
  updated_at  DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cart_customer_sku (customer_id, sku_id),
  KEY idx_cart_customer_added (customer_id, added_at),
  CONSTRAINT fk_cart_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_cart_sku FOREIGN KEY (sku_id) REFERENCES product_skus (id),
  CONSTRAINT chk_cart_qty CHECK (quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operator_id   BIGINT UNSIGNED NOT NULL,
  operator_name VARCHAR(64)     NOT NULL,
  action        ENUM('create','update','delete','approve','reject','login','logout','export') NOT NULL,
  resource_type VARCHAR(32)     NOT NULL,
  resource_id   BIGINT UNSIGNED NOT NULL,
  `before`      JSON            NULL,
  `after`       JSON            NULL,
  payload       JSON            NULL,
  ip            VARCHAR(45)     NULL,
  user_agent    VARCHAR(255)    NULL,
  duration_ms   INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at    DATETIME(3)     NOT NULL,
  PRIMARY KEY (id, created_at),
  KEY idx_operator_created (operator_id, created_at),
  KEY idx_resource (resource_type, resource_id)
) ENGINE=InnoDB
PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p202309 VALUES LESS THAN (TO_DAYS('2023-10-01')),
    PARTITION p202310 VALUES LESS THAN (TO_DAYS('2023-11-01')),
    PARTITION p202311 VALUES LESS THAN (TO_DAYS('2023-12-01')),
    PARTITION p202312 VALUES LESS THAN (TO_DAYS('2024-01-01')),
    PARTITION p202401 VALUES LESS THAN (TO_DAYS('2024-02-01')),
    PARTITION p202402 VALUES LESS THAN (TO_DAYS('2024-03-01')),
    PARTITION p202403 VALUES LESS THAN (TO_DAYS('2024-04-01')),
    PARTITION p202404 VALUES LESS THAN (TO_DAYS('2024-05-01')),
    PARTITION p202405 VALUES LESS THAN (TO_DAYS('2024-06-01')),
    PARTITION p202406 VALUES LESS THAN (TO_DAYS('2024-07-01')),
    PARTITION p202407 VALUES LESS THAN (TO_DAYS('2024-08-01')),
    PARTITION p202408 VALUES LESS THAN (TO_DAYS('2024-09-01')),
    PARTITION p202409 VALUES LESS THAN (TO_DAYS('2024-10-01')),
    PARTITION p202410 VALUES LESS THAN (TO_DAYS('2024-11-01')),
    PARTITION p202411 VALUES LESS THAN (TO_DAYS('2024-12-01')),
    PARTITION p202412 VALUES LESS THAN (TO_DAYS('2025-01-01')),
    PARTITION p202501 VALUES LESS THAN (TO_DAYS('2025-02-01')),
    PARTITION p202502 VALUES LESS THAN (TO_DAYS('2025-03-01')),
    PARTITION p202503 VALUES LESS THAN (TO_DAYS('2025-04-01')),
    PARTITION p202504 VALUES LESS THAN (TO_DAYS('2025-05-01')),
    PARTITION p202505 VALUES LESS THAN (TO_DAYS('2025-06-01')),
    PARTITION p202506 VALUES LESS THAN (TO_DAYS('2025-07-01')),
    PARTITION p202507 VALUES LESS THAN (TO_DAYS('2025-08-01')),
    PARTITION p202508 VALUES LESS THAN (TO_DAYS('2025-09-01')),
    PARTITION p202509 VALUES LESS THAN (TO_DAYS('2025-10-01')),
    PARTITION p202510 VALUES LESS THAN (TO_DAYS('2025-11-01')),
    PARTITION p202511 VALUES LESS THAN (TO_DAYS('2025-12-01')),
    PARTITION p202512 VALUES LESS THAN (TO_DAYS('2026-01-01')),
    PARTITION p202601 VALUES LESS THAN (TO_DAYS('2026-02-01')),
    PARTITION p202602 VALUES LESS THAN (TO_DAYS('2026-03-01')),
    PARTITION p202603 VALUES LESS THAN (TO_DAYS('2026-04-01')),
    PARTITION p202604 VALUES LESS THAN (TO_DAYS('2026-05-01')),
    PARTITION p202605 VALUES LESS THAN (TO_DAYS('2026-06-01')),
    PARTITION p202606 VALUES LESS THAN (TO_DAYS('2026-07-01')),
    PARTITION p202607 VALUES LESS THAN (TO_DAYS('2026-08-01')),
    PARTITION p202608 VALUES LESS THAN (TO_DAYS('2026-09-01')),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);

-- ── 视图 ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_order_summary AS
SELECT o.id AS order_id, o.order_no, c.id AS customer_id, c.name AS customer_name,
       c.level AS customer_level, o.status, o.pay_amount, o.item_count, o.channel,
       o.created_at, COUNT(oi.id) AS item_lines, COALESCE(SUM(oi.quantity), 0) AS total_quantity
FROM orders o
JOIN customers c ON c.id = o.customer_id
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.order_no, c.id, c.name, c.level, o.status, o.pay_amount,
         o.item_count, o.channel, o.created_at;

CREATE OR REPLACE VIEW v_sku_stock AS
SELECT w.id AS warehouse_id, w.name AS warehouse_name, w.region_code,
       p.id AS product_id, p.name AS product_name, s.id AS sku_id, s.sku_code,
       i.quantity, i.locked_quantity, i.available_quantity, i.safety_stock
FROM inventory i
JOIN product_skus s ON s.id = i.sku_id
JOIN products p ON p.id = s.product_id
JOIN warehouses w ON w.id = i.warehouse_id;

-- ── 触发器 ──────────────────────────────────────────────────────────────────

DELIMITER $$

DROP TRIGGER IF EXISTS trg_order_items_audit$$

-- order_items 变更自动写审计日志（约 60% 的行，演示触发器 + 审计联动）
CREATE TRIGGER trg_order_items_audit AFTER INSERT ON order_items FOR EACH ROW
BEGIN
  IF NEW.id % 10 < 6 THEN
    INSERT INTO audit_logs
      (operator_id, operator_name, action, resource_type, resource_id,
       `before`, `after`, payload, ip, user_agent, duration_ms, created_at)
    VALUES (
      NEW.order_id % 1000 + 1, 'system', 'create', 'order_item', NEW.id,
      NULL,
      JSON_OBJECT('order_id', NEW.order_id, 'sku_id', NEW.sku_id, 'quantity', NEW.quantity),
      JSON_OBJECT('source', 'trigger'),
      '127.0.0.1', 'seed-procedure', NEW.quantity % 100,
      DATE_ADD('2023-09-01', INTERVAL (NEW.id % 1095) DAY)
    );
  END IF;
END$$

-- ── 灌数存储过程（确定性：固定种子 + id 取模关联；可重跑）─────────────────

-- 用法: CALL sp_seed_demo(20260812);
-- 说明: 行数与分布由 id 取模决定（跨版本可复现）；RAND() 用于名称/价格等非
-- 关键字段（同一 MySQL 版本内可复现）。
DROP PROCEDURE IF EXISTS sp_seed_demo$$

CREATE PROCEDURE sp_seed_demo(IN seed INT)
BEGIN
  DECLARE done INT DEFAULT 0;
  -- 重置随机序列起点（同一版本内 RAND() 序列可复现）
  SELECT RAND(seed);
  SET SESSION cte_max_recursion_depth = 1000000;
  SET FOREIGN_KEY_CHECKS = 0;

  -- 清空（子表在前）
  TRUNCATE TABLE audit_logs;
  TRUNCATE TABLE shipment_tracking;
  TRUNCATE TABLE cart_items;
  TRUNCATE TABLE product_reviews;
  TRUNCATE TABLE marketing_campaigns;
  TRUNCATE TABLE customer_coupons;
  TRUNCATE TABLE coupons;
  TRUNCATE TABLE shipments;
  TRUNCATE TABLE refund_items;
  TRUNCATE TABLE refunds;
  TRUNCATE TABLE order_payments;
  TRUNCATE TABLE order_items;
  TRUNCATE TABLE orders;
  TRUNCATE TABLE purchase_order_items;
  TRUNCATE TABLE purchase_orders;
  TRUNCATE TABLE price_history;
  TRUNCATE TABLE inventory;
  TRUNCATE TABLE warehouses;
  TRUNCATE TABLE suppliers;
  TRUNCATE TABLE product_skus;
  TRUNCATE TABLE products;
  TRUNCATE TABLE categories;
  TRUNCATE TABLE customer_contacts;
  TRUNCATE TABLE customer_addresses;
  TRUNCATE TABLE customers;

  -- 数字辅助表（会话级临时表）
  DROP TEMPORARY TABLE IF EXISTS _seq;
  CREATE TEMPORARY TABLE _seq (n INT UNSIGNED PRIMARY KEY);
  INSERT INTO _seq
    WITH RECURSIVE cte AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM cte WHERE n < 600000)
    SELECT n FROM cte;
  DROP TEMPORARY TABLE IF EXISTS _seq8;
  CREATE TEMPORARY TABLE _seq8 (n TINYINT UNSIGNED PRIMARY KEY);
  INSERT INTO _seq8 VALUES (1),(2),(3),(4),(5),(6),(7),(8);

  -- ============ A 组 · 会员 ============

  INSERT INTO customers
    (customer_no, email, phone, name, gender, birth_date, level, points, balance,
     region_code, is_verified, status, attributes, source_channel, registered_at,
     last_login_at, created_at, updated_at, version)
  SELECT
    CONCAT('C', LPAD(n, 11, '0')),
    CONCAT('user', n, '@', ELT(1 + n % 4, 'example.com','demo.com','test.dev','mail.com')),
    CONCAT('1', LPAD(1000000000 + (n * 7919) % 9000000000, 10, '0')),
    CONCAT(ELT(1 + n % 8, '张','李','王','赵','刘','陈','杨','黄'),
           ELT(1 + (n DIV 8) % 8, '伟','芳','娜','敏','静','磊','军','洋')),
    ELT(1 + n % 3, 'male','female','other'),
    DATE_ADD(DATE_ADD('1965-01-01', INTERVAL (n % 50) YEAR), INTERVAL (n % 360) DAY),
    ELT(1 + (n % 100) DIV 25, 'normal','silver','gold','platinum'),
    (n * 37) % 100000,
    ROUND(RAND() * 10000, 2),
    ELT(1 + n % 5, '110000','310000','440000','510000','330000'),
    IF(n % 3 = 0, 0, 1),
    IF(n % 100 < 90, 'active', IF(n % 100 < 97, 'frozen', 'closed')),
    JSON_OBJECT('tags', JSON_ARRAY(ELT(1 + n % 4, 'vip','new','high_spend','price_sensitive')),
                'pref_channel', ELT(1 + n % 3, 'app','web','mini')),
    ELT(1 + n % 5, 'app','web','mini','offline','invite'),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 86400) SECOND),
    NULL,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL ((n + 3) % 30) DAY),
    1 + n % 5
  FROM _seq WHERE n <= 50000;

  INSERT INTO customer_addresses
    (customer_id, tag, receiver_name, receiver_phone, province, city, district,
     address_line, postal_code, lat, lng, is_default, is_deleted, created_at, updated_at)
  SELECT
    c.id,
    ELT(1 + s.n % 4, 'home','company','school','other'),
    c.name, c.phone,
    ELT(1 + c.id % 5, '广东省','上海市','北京市','四川省','浙江省'),
    ELT(1 + c.id % 5, '广州市','上海市','北京市','成都市','杭州市'),
    ELT(1 + s.n % 4, '天河区','浦东新区','朝阳区','西湖区'),
    CONCAT('某某路', 1 + (s.n * 37) % 999, '号', 1 + s.n % 30, '栋'),
    CONCAT('5', LPAD(10000 + (c.id * 31 + s.n) % 89999, 5, '0')),
    ROUND(22 + ((c.id + s.n) % 300) / 100, 6),
    ROUND(113 + ((c.id * 2 + s.n) % 300) / 100, 6),
    IF(s.n = 1, 1, 0), 0,
    c.registered_at, c.updated_at
  FROM customers c JOIN _seq8 s ON s.n <= 1 + c.id % 3;

  INSERT INTO customer_contacts
    (customer_id, contact_type, contact_value, is_primary, status, verified_at,
     source, remark, created_at, updated_at, version)
  SELECT
    c.id,
    CASE WHEN s.n = 1 AND c.id % 2 = 0 THEN 'phone'
         WHEN s.n = 1 THEN 'email'
         ELSE 'wechat' END,
    CASE WHEN s.n = 1 AND c.id % 2 = 0 THEN c.phone
         WHEN s.n = 1 THEN CONCAT('user', c.id, '@demo.com')
         ELSE CONCAT('wx_', c.id) END,
    IF(s.n = 1, 1, 0),
    IF(s.n = 1, 'active', 'active'),
    DATE_ADD(c.registered_at, INTERVAL (c.id % 10) DAY),
    'seed', NULL, c.registered_at, c.updated_at, 1 + c.id % 3
  FROM customers c JOIN _seq8 s ON s.n <= 1 + c.id % 2;

  -- ============ B 组 · 商品与供应链 ============

  INSERT INTO categories
    (parent_id, name, code, path, sort_order, icon_url, is_leaf, status,
     description, seo_title, seo_keywords, created_at, updated_at)
  SELECT
    CASE WHEN n <= 12 THEN NULL
         WHEN n <= 60 THEN 1 + n % 12
         ELSE 13 + (n - 61) % 48 END,
    CONCAT(ELT(1 + n % 6, '数码','服饰','家居','美妆','食品','运动'), '分类', n),
    CONCAT('CAT', LPAD(n, 3, '0')),
    CASE WHEN n <= 12 THEN CONCAT('/', n)
         WHEN n <= 60 THEN CONCAT('/', 1 + n % 12, '/', n)
         ELSE CONCAT('/', 1 + (13 + (n - 61) % 48) % 12, '/', 13 + (n - 61) % 48, '/', n) END,
    n % 50,
    CONCAT('https://img.demo.dev/cat/', n, '.png'),
    IF(n > 60, 1, 0), 'enabled',
    NULL, CONCAT('分类', n), CONCAT('cat,', n),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 86400) SECOND)
  FROM _seq WHERE n <= 300;

  INSERT INTO products
    (category_id, product_no, name, subtitle, brand, status, list_price, cost_price,
     spec_type, specs, main_image_url, images, sales_count, rating, review_count,
     is_featured, is_multi_sku, launched_at, expired_at, created_at, updated_at, version)
  SELECT
    61 + n % 240,
    CONCAT('P', LPAD(n, 9, '0')),
    CONCAT(ELT(1 + n % 10, '星云','极光','凌风','幻影','晨曦','曜石','云帆','赤焰','青鸾','流光'),
           ELT(1 + n % 5, '智能手表','无线耳机','蓝牙音箱','机械键盘','电竞鼠标'),
           ELT(1 + n % 4, 'Pro','Max','Lite','Mini'), ' ', n),
    CONCAT('第', n, '号商品副标题'),
    ELT(1 + n % 10, '华为','小米','苹果','联想','戴尔','罗技','漫步者','飞利浦','索尼','三星'),
    IF(n % 100 < 80, 'on_sale', IF(n % 100 < 90, 'off_sale', 'draft')),
    ROUND(50 + (n * 131) % 10000, 2),
    ROUND(ROUND(50 + (n * 131) % 10000, 2) * 0.6, 2),
    IF(n % 3 = 0, 'single', 'multi'),
    IF(n % 3 = 0, NULL,
       JSON_OBJECT('颜色', JSON_ARRAY('红','蓝','黑'), '尺寸', JSON_ARRAY('S','M','L'))),
    CONCAT('https://img.demo.dev/p/', n, '.jpg'),
    JSON_ARRAY(CONCAT('https://img.demo.dev/p/', n, '-1.jpg'),
               CONCAT('https://img.demo.dev/p/', n, '-2.jpg')),
    n % 10000,
    ROUND(3 + (n % 20) / 10, 2),
    n % 500,
    IF(n % 20 = 0, 1, 0),
    IF(n % 3 = 0, 0, 1),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 86400) SECOND),
    NULL,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL ((n + 5) % 30) DAY),
    1 + n % 5
  FROM _seq s WHERE s.n <= 20000;

  INSERT INTO product_skus
    (product_id, sku_code, barcode, name, spec_values, list_price, sale_price,
     cost_price, weight_g, volume_cm3, status, is_default, stock_warn_threshold,
     created_at, updated_at, version)
  SELECT
    p.id,
    CONCAT(p.product_no, '-', s.n),
    CONCAT('69', LPAD(p.id, 7, '0'), LPAD(s.n, 4, '0')),
    CONCAT(p.name, IF(p.spec_type = 'single', '', CONCAT(' ', ELT(1 + s.n % 3, '红-S','蓝-M','黑-L')))),
    IF(p.spec_type = 'single', NULL, JSON_OBJECT('颜色', ELT(1 + s.n % 3, '红','蓝','黑'), '尺寸', ELT(1 + s.n % 3, 'S','M','L'))),
    p.list_price,
    ROUND(p.list_price * (1 - (s.n % 4) * 0.05), 2),
    ROUND(p.cost_price * 0.95, 2),
    100 + (p.id + s.n) % 900,
    500 + (p.id * 3 + s.n) % 3000,
    'on_sale',
    IF(s.n = 1, 1, 0),
    5 + p.id % 50,
    p.created_at, p.updated_at, 1 + p.id % 3
  FROM products p JOIN _seq8 s ON s.n <= 1 + p.id % 5;

  INSERT INTO suppliers
    (supplier_no, name, contact_name, contact_phone, contact_email, region_code,
     address, rating, is_active, payment_terms, lead_time_days, remark, created_at, updated_at)
  SELECT
    CONCAT('S', LPAD(n, 5, '0')),
    CONCAT(ELT(1 + n % 6, '华南','华东','华北','西南','华中','西北'), '供应集团', n),
    CONCAT(ELT(1 + n % 6, '陈','林','周','吴','郑','孙'), '经理', n % 100),
    CONCAT('1', LPAD(13000000000 + (n * 3571) % 900000000, 10, '0')),
    CONCAT('supplier', n, '@supply.com'),
    ELT(1 + n % 5, '440000','310000','110000','510000','420000'),
    CONCAT('供应园区', n % 100, '号'),
    ROUND(3 + RAND() * 2, 2),
    IF(n % 10 = 9, 0, 1),
    ELT(1 + n % 4, 'cod','net30','net60','prepaid'),
    3 + n % 28,
    NULL,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL ((n + 1) % 30) DAY)
  FROM _seq WHERE n <= 500;

  INSERT INTO warehouses
    (warehouse_no, name, region_code, address, manager_name, manager_phone,
     location, capacity, used_capacity, is_cold_chain, status, created_at, updated_at)
  SELECT
    CONCAT('W', LPAD(n, 3, '0')),
    CONCAT(ELT(1 + n % 5, '华东','华南','华北','西南','华中'), '中心仓', n),
    ELT(1 + n % 5, '310000','440000','110000','510000','420000'),
    CONCAT('物流园', n % 50, '区'),
    CONCAT('仓管', n % 30), CONCAT('1', LPAD(13800000000 + (n * 13) % 900000000, 10, '0')),
    ST_SRID(POINT(
      CASE n % 5 WHEN 0 THEN 121.47 WHEN 1 THEN 113.26 WHEN 2 THEN 116.40 WHEN 3 THEN 104.07 ELSE 114.30 END + n * 0.01,
      CASE n % 5 WHEN 0 THEN 31.23 WHEN 1 THEN 23.13 WHEN 2 THEN 39.90 WHEN 3 THEN 30.57 ELSE 30.59 END + n * 0.008
    ), 4326),
    10000 + n * 500,
    (10000 + n * 500) * (30 + n % 50) DIV 100,
    IF(n % 4 = 0, 1, 0),
    IF(n % 10 = 9, 'maintenance', 'active'),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL ((n + 2) % 30) DAY)
  FROM _seq WHERE n <= 30;

  INSERT INTO inventory
    (sku_id, warehouse_id, quantity, locked_quantity, safety_stock, last_inbound_at,
     last_outbound_at, inbound_count, outbound_count, status, version, created_at, updated_at)
  SELECT
    s.id, w.id,
    10 + (s.id * 7 + w.id) % 500,
    IF((s.id + w.id) % 10 < 3, (10 + (s.id * 7 + w.id) % 500) DIV 5, 0),
    5 + s.id % 50,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL ((s.id * 3 + w.id) % 1095) DAY), INTERVAL (s.id % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL ((s.id + w.id * 5) % 1095) DAY), INTERVAL (s.id % 86400) SECOND),
    s.id % 20, s.id % 30,
    IF((s.id + w.id) % 10 = 9, 'damaged', 'normal'),
    1 + (s.id + w.id) % 4,
    s.created_at, s.updated_at
  FROM product_skus s JOIN warehouses w ON w.id <= 1 + s.id % 3;

  INSERT INTO price_history
    (sku_id, old_price, new_price, change_reason, operator_type, operator_id,
     effective_at, expires_at, remark, created_at)
  SELECT
    s.id,
    ROUND(s.sale_price * (1 - (s.id + x.n) % 7 / 50), 2),
    ROUND(s.sale_price * (1 + (s.id * 3 + x.n) % 9 / 40), 2),
    ELT(1 + (s.id + x.n) % 5, 'promotion','cost','clearance','manual','competitor'),
    ELT(1 + s.id % 3, 'system','admin','merchant'),
    1 + (s.id + x.n) % 100,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL ((s.id * 13 + x.n * 31) % 1095) DAY), INTERVAL (s.id % 86400) SECOND),
    NULL, NULL,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL ((s.id * 13 + x.n * 31) % 1095) DAY), INTERVAL (s.id % 86400) SECOND)
  FROM product_skus s JOIN _seq8 x ON x.n <= 1 + s.id % 4;

  -- ============ C 组 · 采购 ============

  INSERT INTO purchase_orders
    (po_no, supplier_id, warehouse_id, status, total_amount, item_count, tax_rate,
     expected_at, confirmed_at, received_at, creator_id, approver_id, remark,
     created_at, updated_at)
  SELECT
    CONCAT('PO', LPAD(n, 8, '0')),
    1 + n % 500,
    1 + n % 30,
    IF(n % 100 < 30, 'received', IF(n % 100 < 55, 'partial', IF(n % 100 < 85, 'confirmed', IF(n % 100 < 95, 'draft', 'cancelled')))),
    ROUND(5000 + RAND() * 950000, 2),
    1 + n % 6,
    13.00,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 365) DAY), INTERVAL (n % 86400) SECOND),
    IF(n % 100 < 85, DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 365) DAY), INTERVAL (n % 86400) SECOND), NULL),
    IF(n % 100 < 55, DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 365) DAY), INTERVAL (n % 86400) SECOND), NULL),
    1 + n % 50,
    IF(n % 100 < 85, 1 + n % 20, NULL),
    NULL,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 365) DAY), INTERVAL (n % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 365) DAY), INTERVAL ((n + 1) % 30) DAY)
  FROM _seq WHERE n <= 8000;

  INSERT INTO purchase_order_items
    (purchase_order_id, sku_id, quantity, unit_cost, received_qty, qualified_qty,
     defect_qty, status, remark, created_at, updated_at)
  SELECT
    po.id,
    1 + (po.id * 7 + s.n * 13) % 60000,
    1 + (po.id + s.n) % 200,
    ROUND(10 + RAND() * 500, 2),
    IF(po.status IN ('received','partial'), 1 + (po.id + s.n) % 200, 0),
    IF(po.status IN ('received','partial'), (1 + (po.id + s.n) % 200) * (100 - (po.id + s.n) % 5) DIV 100, 0),
    IF(po.status = 'received', (1 + (po.id + s.n) % 200) * ((po.id + s.n) % 5) DIV 100, 0),
    IF(po.status = 'received', 'done', IF(po.status = 'partial', 'partial', 'pending')),
    NULL, po.created_at, po.updated_at
  FROM purchase_orders po JOIN _seq8 s ON s.n <= 1 + po.id % 9;

  -- ============ D 组 · 订单域 ============

  INSERT INTO orders
    (order_no, customer_id, customer_address_id, coupon_id, status, pay_method,
     item_count, items_total, discount_amount, shipping_fee, coupon_deduct,
     points_deduct, gift_points, receiver_name, receiver_phone, receiver_address,
     region_code, channel, is_invoice, remark, created_at, paid_at, shipped_at,
     completed_at, cancelled_at, version, updated_at)
  SELECT
    CONCAT('ORD', LPAD(n, 10, '0')),
    1 + n % 50000,
    2 * (1 + n % 50000) - 1 + n % 2,
    IF(n % 4 = 0, 1 + n % 500, NULL),
    IF(n % 100 < 50, 'completed', IF(n % 100 < 65, 'cancelled', IF(n % 100 < 75, 'paid', IF(n % 100 < 83, 'shipped', IF(n % 100 < 98, 'refunded', 'pending'))))),
    ELT(1 + n % 5, 'wechat','alipay','card','balance','cod'),
    1 + n % 8,
    ROUND(50 + (n * 131 + n % 7) % 10000 + n % 13, 2),
    ROUND(ROUND(50 + (n * 131 + n % 7) % 10000 + n % 13, 2) * (n % 20) / 200, 2),
    6 + n % 20,
    IF(n % 4 = 0, ROUND(ROUND(50 + (n * 131 + n % 7) % 10000 + n % 13, 2) * 0.05, 2), 0),
    IF(n % 5 = 0, n % 1000, 0),
    ROUND(ROUND(50 + (n * 131 + n % 7) % 10000 + n % 13, 2) / 10),
    CONCAT(ELT(1 + n % 8, '张','李','王','赵','刘','陈','杨','黄'), '客户', n % 1000),
    CONCAT('1', LPAD(13500000000 + (n * 97) % 900000000, 10, '0')),
    CONCAT('收货地址', n % 5000, '号'),
    ELT(1 + n % 5, '110000','310000','440000','510000','330000'),
    ELT(1 + n % 4, 'app','web','mini','offline'),
    IF(n % 10 < 2, 1, 0),
    NULL,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 86400) SECOND),
    IF(n % 100 >= 65, DATE_ADD(DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 1440) MINUTE), INTERVAL (n % 86400) SECOND), NULL),
    IF(n % 100 >= 65 AND n % 100 < 65 + 8 + 33, DATE_ADD(DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 1440) MINUTE), INTERVAL (1 + n % 3) DAY), NULL),
    IF(n % 100 < 50, DATE_ADD(DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 1440) MINUTE), INTERVAL (1 + n % 8) DAY), NULL),
    IF(n % 100 >= 65 AND n % 100 < 75, DATE_ADD(DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL (n % 60) MINUTE), INTERVAL (n % 86400) SECOND), NULL),
    1 + n % 5,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 1095) DAY), INTERVAL ((n + 3) % 30) DAY)
  FROM _seq WHERE n <= 100000;

  INSERT INTO order_items
    (order_id, sku_id, product_name, sku_name, spec_values, unit_price, quantity,
     discount_share, gift_points, is_reviewed, status, created_at, updated_at)
  SELECT
    o.id,
    1 + (o.id * 13 + s.n * 29) % 60000,
    p.name, ps.name, ps.spec_values, ps.sale_price,
    1 + (o.id + s.n) % 4,
    ROUND(o.discount_amount / o.item_count, 2),
    o.gift_points DIV o.item_count,
    IF(o.status = 'completed' AND s.n % 3 < 2, 1, 0),
    IF(o.status = 'refunded', 'refunded', 'normal'),
    o.created_at, o.updated_at
  FROM orders o
  JOIN _seq8 s ON s.n <= 1 + o.id % 5
  JOIN product_skus ps ON ps.id = 1 + (o.id * 13 + s.n * 29) % 60000
  JOIN products p ON p.id = ps.product_id;

  INSERT INTO order_payments
    (payment_no, order_id, channel, amount, status, payer_account, trade_no,
     currency, fee, paid_at, notify_url, notify_count, callback_data, remark,
     created_at, updated_at)
  SELECT
    CONCAT('PAY', LPAD(o.id, 6, '0'), LPAD(s.n, 2, '0')),
    o.id,
    ELT(1 + (o.id + s.n) % 4, 'wechat','alipay','card','balance'),
    IF(s.n = 1, ROUND(o.pay_amount * 0.6, 2), ROUND(o.pay_amount * 0.4, 2)),
    'success',
    CONCAT('payer_', o.id % 100000),
    CONCAT('T', o.id, '-', s.n),
    'CNY',
    ROUND(IF(s.n = 1, o.pay_amount * 0.6, o.pay_amount * 0.4) * 0.006, 2),
    DATE_ADD(o.paid_at, INTERVAL (s.n - 1) MINUTE),
    'https://demo.dev/notify',
    1 + o.id % 3,
    JSON_OBJECT('order_no', o.order_no, 'split', s.n),
    NULL, o.created_at, o.updated_at
  FROM orders o
  JOIN _seq8 s ON s.n <= 1 + IF(o.id % 20 < 2, 1, 0)
  WHERE o.status != 'pending';

  INSERT INTO refunds
    (refund_no, order_id, customer_id, reason_type, reason_detail, amount, status,
     channel, apply_source, applied_at, audited_at, refunded_at, auditor_id,
     images, remark, created_at, updated_at)
  SELECT
    CONCAT('RF', LPAD(o.id, 6, '0'), LPAD(s.n, 2, '0')),
    o.id, o.customer_id,
    ELT(1 + (o.id + s.n) % 5, 'quality','not_as_described','logistics','no_reason','other'),
    CONCAT('退款原因', (o.id + s.n) % 20),
    ROUND(o.pay_amount * (0.3 + (s.n % 3) * 0.3), 2),
    IF((o.id + s.n) % 10 = 0, 'refunding', 'done'),
    IF((o.id + s.n) % 4 = 0, 'balance', 'original'),
    ELT(1 + (o.id + s.n) % 3, 'customer','merchant','system'),
    DATE_ADD(o.paid_at, INTERVAL (1 + o.id % 10) DAY),
    DATE_ADD(o.paid_at, INTERVAL (2 + o.id % 10) DAY),
    IF((o.id + s.n) % 10 = 0, NULL, DATE_ADD(o.paid_at, INTERVAL (3 + o.id % 10) DAY)),
    1 + (o.id + s.n) % 20,
    JSON_ARRAY(CONCAT('https://img.demo.dev/refund/', o.id, '.jpg')),
    NULL,
    DATE_ADD(o.paid_at, INTERVAL (1 + o.id % 10) DAY),
    DATE_ADD(o.paid_at, INTERVAL (2 + o.id % 10) DAY)
  FROM orders o
  JOIN _seq8 s ON s.n <= 1 + o.id % 3
  WHERE o.status = 'refunded';

  INSERT INTO refund_items
    (refund_id, order_item_id, quantity, unit_amount, reason, is_include_shipping,
     status, created_at, updated_at)
  SELECT
    r.id,
    1 + (r.id * 7 + s.n * 3) % 300000,
    1 + (r.id + s.n) % 3,
    ROUND(r.amount / (1 + (r.id + s.n) % 3), 2),
    CONCAT('明细退款', (r.id + s.n) % 10),
    IF(s.n = 1, 0, 1),
    IF(r.status = 'done', 'done', 'pending'),
    r.created_at, r.updated_at
  FROM refunds r JOIN _seq8 s ON s.n <= 1 + r.id % 3;

  -- ============ E 组 · 物流 ============

  INSERT INTO shipments
    (shipment_no, tracking_no, order_id, warehouse_id, logistics_company,
     carrier_code, status, receiver_name, receiver_phone, receiver_address,
     item_count, weight_g, fee, is_signed, shipped_at, delivered_at, signed_at,
     remark, created_at, updated_at)
  SELECT
    CONCAT('SH', LPAD(o.id, 6, '0')),
    CONCAT('TRK', LPAD(o.id, 7, '0')),
    o.id,
    1 + o.id % 30,
    ELT(1 + o.id % 5, 'sf','zto','yto','jd','other'),
    CONCAT('C', o.id % 100),
    IF(o.status = 'cancelled', 'exception',
       IF(o.status = 'pending', 'pending',
          ELT(1 + o.id % 10, 'signed','signed','signed','signed','signed','signed','delivered','in_transit','shipped','picked'))),
    o.receiver_name, o.receiver_phone, o.receiver_address,
    o.item_count,
    o.item_count * (100 + o.id % 900),
    8 + o.id % 20,
    IF(o.status = 'cancelled' OR o.status = 'pending', 0, o.id % 10 < 6),
    IF(o.status IN ('cancelled','pending'), NULL, COALESCE(o.shipped_at, o.paid_at)),
    IF(o.id % 10 < 7, DATE_ADD(COALESCE(o.shipped_at, o.paid_at), INTERVAL (1 + o.id % 4) DAY), NULL),
    IF(o.id % 10 < 6, DATE_ADD(COALESCE(o.shipped_at, o.paid_at), INTERVAL (2 + o.id % 4) DAY), NULL),
    NULL, o.created_at, o.updated_at
  FROM orders o;

  INSERT INTO shipment_tracking
    (shipment_id, sort_order, tracked_at, status, node_code, node_name, city,
     description, location_desc, created_at)
  SELECT
    s.id,
    t.n,
    DATE_ADD(COALESCE(s.shipped_at, s.created_at), INTERVAL (t.n * 2 + s.id % 3) HOUR),
    IF(s.status = 'exception' AND t.n > 1, 'exception',
       ELT(1 + t.n % 7, 'picked','shipped','in_transit','in_transit','out_for_delivery','delivered','signed')),
    CONCAT('NODE', t.n),
    ELT(1 + t.n % 7, '已揽收','已发货','运输中','到达中转站','派送中','已送达','已签收'),
    ELT(1 + s.id % 5, '广州市','上海市','北京市','成都市','杭州市'),
    CONCAT('物流节点', t.n, ' 状态更新'),
    CONCAT('分拨中心', s.id % 50),
    s.created_at
  FROM shipments s JOIN _seq8 t ON t.n <= 4 + s.id % 3;

  -- ============ F 组 · 营销与互动 ============

  INSERT INTO coupons
    (coupon_no, name, type, discount_amount, discount_rate, min_spend, max_discount,
     total_qty, issued_qty, used_qty, valid_from, valid_until, per_user_limit,
     status, scope, created_at, updated_at)
  SELECT
    CONCAT('CP', LPAD(n, 6, '0')),
    CONCAT(ELT(1 + n % 5, '新人立减','满减券','折扣券','运费券','会员专享'), n),
    ELT(1 + n % 3, 'amount','rate','shipping'),
    IF(n % 3 = 0, ROUND(5 + RAND() * 95, 2), 0),
    IF(n % 3 = 1, 5 + n % 40, 0),
    ROUND(50 + RAND() * 500, 2),
    IF(n % 3 = 1, 50 + n % 50, 0),
    1000 + n * 7,
    (1000 + n * 7) * (30 + n % 50) DIV 100,
    ((1000 + n * 7) * (30 + n % 50) DIV 100) * (n % 70) DIV 100,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 300) DAY), INTERVAL (n % 86400) SECOND),
    DATE_ADD(DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 300) DAY), INTERVAL (30 + n % 60) DAY), INTERVAL (n % 86400) SECOND),
    1 + n % 3,
    IF(n % 10 < 7, 'active', IF(n % 10 = 9, 'expired', 'draft')),
    ELT(1 + n % 3, 'all','category','product'),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 300) DAY), INTERVAL (n % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 300) DAY), INTERVAL ((n + 1) % 30) DAY)
  FROM _seq WHERE n <= 500;

  INSERT INTO customer_coupons
    (customer_id, coupon_id, code, status, received_at, used_at, used_order_id,
     expires_at, source, batch_no, created_at, updated_at)
  SELECT
    1 + (s.n * 7) % 50000,
    1 + (s.n DIV 50000 + s.n % 500) % 500,
    CONCAT('CC', LPAD(s.n, 8, '0')),
    IF(s.n % 100 < 45, 'used', IF(s.n % 100 < 80, 'unused', IF(s.n % 100 < 95, 'expired', 'refunded'))),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (s.n % 300) DAY), INTERVAL (s.n % 86400) SECOND),
    IF(s.n % 100 < 45, DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (s.n % 300) DAY), INTERVAL (s.n % 20) DAY), NULL),
    IF(s.n % 100 < 45, 1 + (s.n * 11) % 100000, NULL),
    DATE_ADD(DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (s.n % 300) DAY), INTERVAL (30 + s.n % 60) DAY), INTERVAL (s.n % 86400) SECOND),
    ELT(1 + s.n % 4, 'campaign','register','birthday','manual'),
    CONCAT('B', s.n DIV 5000),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (s.n % 300) DAY), INTERVAL (s.n % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (s.n % 300) DAY), INTERVAL ((s.n + 1) % 30) DAY)
  FROM _seq s WHERE s.n <= 150000;

  INSERT INTO marketing_campaigns
    (campaign_no, name, channels, status, budget, spent, start_at, end_at,
     target_user, discount_policy, created_by, approved_by, remark, created_at, updated_at)
  SELECT
    CONCAT('MC', LPAD(n, 6, '0')),
    CONCAT(ELT(1 + n % 6, '双十一','618','周年庆','新品首发','清仓特卖','会员日'), n),
    ELT(1 + n % 8, 'app','app,web','app,mini','web','mini','app,web,mini','sms,app','app,web,mini,sms'),
    IF(n % 10 < 5, 'running', IF(n % 10 < 8, 'ended', IF(n % 10 = 8, 'paused', 'draft'))),
    ROUND(10000 + RAND() * 990000, 2),
    ROUND((10000 + RAND() * 990000) * (n % 90) / 100, 2),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 300) DAY), INTERVAL (n % 86400) SECOND),
    DATE_ADD(DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 300) DAY), INTERVAL (7 + n % 30) DAY), INTERVAL (n % 86400) SECOND),
    ELT(1 + n % 4, 'all','new','returning','level_above'),
    JSON_OBJECT('type', ELT(1 + n % 3, 'full_reduction','discount','gift'), 'value', n % 100),
    1 + n % 50,
    IF(n % 10 < 8, 1 + n % 10, NULL),
    NULL,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 300) DAY), INTERVAL (n % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (n % 300) DAY), INTERVAL ((n + 1) % 30) DAY)
  FROM _seq WHERE n <= 2000;

  INSERT INTO product_reviews
    (customer_id, sku_id, order_id, rating, content, images, is_anonymous,
     is_verified_purchase, helpful_count, reply_content, reply_at, status,
     created_at, updated_at)
  SELECT
    1 + (s.id * 13) % 50000,
    s.id,
    IF(s.id % 4 = 0, NULL, 1 + (s.id * 17) % 100000),
    3 + s.id % 3,
    CONCAT(ELT(1 + s.id % 6, '质量很好，值得购买！','性价比高，物流快','一般般，能用','非常满意','做工精细','包装完好'), ' ', s.sku_code),
    JSON_ARRAY(CONCAT('https://img.demo.dev/r/', s.id, '.jpg')),
    IF(s.id % 10 < 2, 1, 0),
    IF(s.id % 4 = 0, 0, 1),
    s.id % 50,
    IF(s.id % 3 = 0, CONCAT('感谢评价，祝您购物愉快 #', s.id % 100), NULL),
    IF(s.id % 3 = 0, DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (s.id % 1095) DAY), INTERVAL (s.id % 86400) SECOND), NULL),
    IF(s.id % 100 < 95, 'visible', IF(s.id % 100 < 98, 'hidden', 'deleted')),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (s.id % 1095) DAY), INTERVAL (s.id % 86400) SECOND),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (s.id % 1095) DAY), INTERVAL ((s.id + 1) % 30) DAY)
  FROM product_skus s WHERE s.id <= 60000;

  -- ============ G 组 · 行为与审计 ============

  INSERT INTO cart_items
    (customer_id, sku_id, quantity, selected, added_at, source, channel, is_deleted,
     remark, created_at, updated_at)
  SELECT
    c.id,
    1 + (c.id * 7 + s.n * 3) % 60000,
    1 + (c.id + s.n) % 5,
    IF(s.n = 1, 1, 0),
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (c.id % 1095) DAY), INTERVAL (c.id % 86400) SECOND),
    ELT(1 + (c.id + s.n) % 4, 'detail','recommend','search','campaign'),
    ELT(1 + c.id % 3, 'app','web','mini'),
    0, NULL, c.registered_at, c.updated_at
  FROM customers c JOIN _seq8 s ON s.n <= 1 + c.id % 2;

  -- 审计日志 · 直插部分（其余由 trg_order_items_audit 触发器产生）
  INSERT INTO audit_logs
    (operator_id, operator_name, action, resource_type, resource_id, `before`,
     `after`, payload, ip, user_agent, duration_ms, created_at)
  SELECT
    1 + s.n % 100,
    CONCAT('op', s.n % 100),
    ELT(1 + s.n % 8, 'create','update','delete','approve','reject','login','logout','export'),
    ELT(1 + s.n % 4, 'order','product','customer','refund'),
    1 + s.n % 100000,
    JSON_OBJECT('state', 'before'),
    JSON_OBJECT('state', 'after'),
    JSON_OBJECT('seq', s.n),
    CONCAT('10.0.', s.n % 200, '.', s.n % 250),
    ELT(1 + s.n % 3, 'Mozilla/5.0 (demo)','curl/8 (demo)','dsh-agent/0.1 (demo)'),
    s.n % 500,
    DATE_ADD(DATE_ADD('2023-09-01', INTERVAL (s.n % 1095) DAY), INTERVAL (s.n % 86400) SECOND)
  FROM _seq s WHERE s.n <= 20000;

  -- 批量 INSERT..SELECT 的行不会立即进入 FULLTEXT 索引（InnoDB 延迟批量更新），
  -- OPTIMIZE 强制重建，使全文检索在灌数完成后立即可用
  OPTIMIZE TABLE products;

  SET FOREIGN_KEY_CHECKS = 1;
END$$

DELIMITER ;

-- 哨兵输出
SELECT 'schema ready' AS status;
