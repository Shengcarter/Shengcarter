-- Service costing: the products each service uses, and the money split of
-- every completed service:
--   price − actual product cost → operations % → staff % / salon profit %
-- stored in full for every service sold, with corrections kept as revisions.

-- ---------------------------------------------------------------------------
-- 1. Products used by measure. Stock can be counted in fractions (2.5 packs,
--    0.2 of a bottle), and a product can be used in a smaller unit than it is
--    stocked in: "stocked in bottles, used in ml, 1 bottle = 500 ml". The cost
--    per ml then comes from the bottle's recorded purchase cost.
-- ---------------------------------------------------------------------------
ALTER TABLE products
  MODIFY quantity DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  ADD COLUMN usage_unit VARCHAR(20) NULL COMMENT 'Unit used in services when smaller than the stock unit (e.g. ml)' AFTER unit,
  ADD COLUMN usage_per_unit DECIMAL(12,3) NULL COMMENT 'Usage units in one stock unit (e.g. 500 ml per bottle)' AFTER usage_unit,
  ADD CONSTRAINT chk_products_usage CHECK (usage_per_unit IS NULL OR usage_per_unit > 0);

ALTER TABLE inventory_transactions
  MODIFY type ENUM('opening','purchase','sale','refund','adjustment','stock_in','stock_out','damage','internal_use','service_use') NOT NULL,
  MODIFY quantity_change DECIMAL(12,3) NOT NULL,
  MODIFY quantity_before DECIMAL(12,3) NOT NULL,
  MODIFY quantity_after  DECIMAL(12,3) NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Services priced by length or complexity: with a maximum price, the
--    actual price is entered at checkout between the two.
-- ---------------------------------------------------------------------------
ALTER TABLE services
  ADD COLUMN max_price DECIMAL(14,2) NULL COMMENT 'Set when the price varies: charged between price and max_price' AFTER price,
  ADD CONSTRAINT chk_services_max_price CHECK (max_price IS NULL OR max_price >= price);

-- ---------------------------------------------------------------------------
-- 3. Service recipe: the products a service normally uses (for planning and to
--    pre-fill checkout). The money split always uses what was actually used.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_products (
  service_id  INT UNSIGNED  NOT NULL,
  product_id  INT UNSIGNED  NOT NULL,
  quantity    DECIMAL(12,3) NOT NULL COMMENT 'Expected quantity per service, in the product''s usage unit',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (service_id, product_id),
  KEY idx_service_products_product (product_id),
  CONSTRAINT fk_service_products_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE,
  CONSTRAINT fk_service_products_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT chk_service_products_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Products used, recorded by the stylist on the appointment before it is
--    billed. Checkout starts from these; stock moves only at checkout.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_products (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  appointment_id  INT UNSIGNED  NOT NULL,
  service_id      INT UNSIGNED  NOT NULL,
  product_id      INT UNSIGNED  NOT NULL,
  quantity        DECIMAL(12,3) NOT NULL COMMENT 'In the product''s usage unit',
  recorded_by     INT UNSIGNED  NULL,
  recorded_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_appointment_products (appointment_id, service_id, product_id),
  KEY idx_appointment_products_product (product_id),
  CONSTRAINT fk_appointment_products_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_appointment_products_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE,
  CONSTRAINT fk_appointment_products_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT fk_appointment_products_user FOREIGN KEY (recorded_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_appointment_products_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. Products actually used on a service sold, with the cost at that moment
--    (from the recorded purchase cost, never the retail price). Later price
--    changes never alter these rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_item_products (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  sale_item_id    INT UNSIGNED  NOT NULL,
  product_id      INT UNSIGNED  NOT NULL,
  product_name    VARCHAR(150)  NOT NULL,
  unit            VARCHAR(20)   NOT NULL COMMENT 'Unit of `quantity`',
  quantity        DECIMAL(12,3) NOT NULL,
  stock_quantity  DECIMAL(12,3) NOT NULL COMMENT 'Taken from stock, in the stock unit',
  unit_cost       DECIMAL(14,4) NOT NULL COMMENT 'Cost per `unit` when used',
  total_cost      DECIMAL(14,2) NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sale_item_products (sale_item_id, product_id),
  KEY idx_sale_item_products_product (product_id),
  CONSTRAINT fk_sale_item_products_item FOREIGN KEY (sale_item_id) REFERENCES sale_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_item_products_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_sale_item_products_amounts CHECK (quantity > 0 AND stock_quantity >= 0 AND unit_cost >= 0 AND total_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6. The money split of every service sold. The percentages used are stored
--    with it, so changing the rules later never changes past figures.
--    Customer, receipt, time and payment status come from the sale; the staff
--    and their shares from sale_item_staff and commissions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_item_finance (
  sale_item_id           INT UNSIGNED  NOT NULL,
  sale_id                INT UNSIGNED  NOT NULL,
  branch_id              INT UNSIGNED  NOT NULL,
  service_id             INT UNSIGNED  NULL,
  service_name           VARCHAR(150)  NOT NULL,
  performed_at           DATETIME      NOT NULL COMMENT 'When the service was completed and billed (UTC)',
  price                  DECIMAL(14,2) NOT NULL COMMENT 'Charged for the service, after discounts',
  product_cost           DECIMAL(14,2) NOT NULL,
  amount_after_products  DECIMAL(14,2) NOT NULL,
  operations_rate        DECIMAL(5,2)  NOT NULL,
  operations_amount      DECIMAL(14,2) NOT NULL,
  distributable_amount   DECIMAL(14,2) NOT NULL,
  staff_rate             DECIMAL(5,2)  NOT NULL,
  staff_pool             DECIMAL(14,2) NOT NULL,
  profit_rate            DECIMAL(5,2)  NOT NULL,
  salon_profit           DECIMAL(14,2) NOT NULL COMMENT 'Below zero only when products cost more than the price (flagged)',
  staff_count            TINYINT UNSIGNED NOT NULL,
  split_rule             VARCHAR(20)   NOT NULL DEFAULT 'equal',
  margin_status          ENUM('positive','zero','negative') NOT NULL,
  review_status          ENUM('not_needed','pending','reviewed') NOT NULL DEFAULT 'not_needed',
  review_note            VARCHAR(500)  NULL,
  reviewed_by            INT UNSIGNED  NULL,
  reviewed_at            DATETIME      NULL,
  revision               SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sale_item_id),
  KEY idx_sale_item_finance_branch (branch_id, performed_at),
  KEY idx_sale_item_finance_sale (sale_id),
  KEY idx_sale_item_finance_service (service_id, performed_at),
  KEY idx_sale_item_finance_review (branch_id, review_status),
  CONSTRAINT fk_sale_item_finance_item FOREIGN KEY (sale_item_id) REFERENCES sale_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_item_finance_sale FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_item_finance_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_sale_item_finance_service FOREIGN KEY (service_id) REFERENCES services (id),
  CONSTRAINT fk_sale_item_finance_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_sale_item_finance_amounts CHECK (price >= 0 AND product_cost >= 0 AND operations_amount >= 0 AND distributable_amount >= 0 AND staff_pool >= 0),
  -- Every shilling of the price is accounted for.
  CONSTRAINT chk_sale_item_finance_balance CHECK (price = product_cost + operations_amount + staff_pool + salon_profit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 7. Corrections: every change to a completed service's figures keeps the
--    previous and new values, who changed them, when and why.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_item_finance_revisions (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  sale_item_id  INT UNSIGNED  NOT NULL,
  revision      SMALLINT UNSIGNED NOT NULL,
  reason        VARCHAR(500)  NOT NULL,
  before_data   JSON          NOT NULL,
  after_data    JSON          NOT NULL,
  changed_by    INT UNSIGNED  NULL,
  changed_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sale_item_finance_revisions (sale_item_id, revision),
  CONSTRAINT fk_sale_item_finance_revisions_item FOREIGN KEY (sale_item_id) REFERENCES sale_item_finance (sale_item_id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_item_finance_revisions_user FOREIGN KEY (changed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 8. The split rules (Settings → Financial). Staff + salon profit must be 100%.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO settings (setting_key, group_name, setting_value) VALUES
  ('financial.operations_percentage',   'financial', CAST('30' AS JSON)),
  ('financial.staff_pool_percentage',   'financial', CAST('50' AS JSON)),
  ('financial.salon_profit_percentage', 'financial', CAST('50' AS JSON)),
  ('financial.staff_split_rule',        'financial', JSON_QUOTE('equal'));

-- ---------------------------------------------------------------------------
-- 9. Permissions: stylists record the products they use; correcting a
--    completed service's figures is separate from changing the rules
--    (settings.manage), prices and recipes (services.manage) or product costs
--    and stock (inventory.manage).
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('appointments.record_products', 'appointments', 'Record the products used on appointments'),
  ('sales.correct',                'pos',          'Correct completed services (products used, price, staff) and review low-margin services')
ON DUPLICATE KEY UPDATE module = VALUES(module), description = VALUES(description);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE (p.code = 'appointments.record_products' AND r.slug IN ('super_admin', 'receptionist', 'stylist'))
   OR (p.code = 'sales.correct' AND r.slug = 'super_admin');

-- ---------------------------------------------------------------------------
-- 10. The demo accountant shared a name with the demo barber; give it its own.
-- ---------------------------------------------------------------------------
UPDATE users SET full_name = 'Imani Kweka'
 WHERE is_demo = 1 AND email = 'accountant.demo@zolastylish.local' AND full_name = 'Baraka Mushi';
