-- Per-service financial rules, sales recorded for a previous date, voided
-- sales, audit before/after values and server-checked login sessions.

-- ---------------------------------------------------------------------------
-- 1. Financial rules per service, versioned. A sale stores the rule version
--    it was calculated with, so changing a rule never changes past sales.
--    Every existing service keeps the general formula, now as an explicit rule.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_financial_rules (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  service_id  INT UNSIGNED NOT NULL,
  version     SMALLINT UNSIGNED NOT NULL,
  method      ENUM('general','bands','unconfigured') NOT NULL,
  config      JSON         NOT NULL COMMENT 'See backend/src/services/financialRules.js',
  notes       VARCHAR(255) NULL,
  created_by  INT UNSIGNED NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_financial_rules (service_id, version),
  CONSTRAINT fk_service_financial_rules_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE,
  CONSTRAINT fk_service_financial_rules_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE services
  ADD COLUMN financial_rule_id INT UNSIGNED NULL COMMENT 'Current financial rule version' AFTER max_price,
  ADD CONSTRAINT fk_services_financial_rule FOREIGN KEY (financial_rule_id) REFERENCES service_financial_rules (id) ON DELETE SET NULL;

INSERT INTO service_financial_rules (service_id, version, method, config, notes)
SELECT s.id, 1, 'general',
       JSON_OBJECT('method', 'general', 'productCost', 'deduct', 'productsIncluded', TRUE, 'staffSplit', 'equal', 'bands', JSON_ARRAY()),
       'General formula (set when service rules were introduced)'
FROM services s
WHERE NOT EXISTS (SELECT 1 FROM service_financial_rules r WHERE r.service_id = s.id);

UPDATE services s JOIN service_financial_rules r ON r.service_id = s.id AND r.version = 1
SET s.financial_rule_id = r.id
WHERE s.financial_rule_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Each service's breakdown records how it was calculated. Fixed-amount
--    rules have no percentages. consumption_cost is the stock cost of the
--    products used, even when the rule does not deduct it from the price.
-- ---------------------------------------------------------------------------
ALTER TABLE sale_item_finance
  MODIFY operations_rate DECIMAL(5,2) NULL,
  MODIFY staff_rate      DECIMAL(5,2) NULL,
  MODIFY profit_rate     DECIMAL(5,2) NULL,
  ADD COLUMN consumption_cost   DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'Stock cost of the products used' AFTER product_cost,
  ADD COLUMN product_cost_basis VARCHAR(20)  NOT NULL DEFAULT 'recorded' COMMENT 'recorded | recipe_estimate (imported sales) | none' AFTER consumption_cost,
  ADD COLUMN calculation_method VARCHAR(20)  NOT NULL DEFAULT 'general' COMMENT 'general | band | band_general' AFTER split_rule,
  ADD COLUMN rule_id            INT UNSIGNED NULL AFTER calculation_method,
  ADD COLUMN rule_version       SMALLINT UNSIGNED NULL AFTER rule_id,
  ADD COLUMN rule_snapshot      JSON         NULL COMMENT 'The rule as applied to this service' AFTER rule_version,
  ADD KEY idx_sale_item_finance_method (branch_id, calculation_method),
  ADD CONSTRAINT fk_sale_item_finance_rule FOREIGN KEY (rule_id) REFERENCES service_financial_rules (id) ON DELETE SET NULL;

UPDATE sale_item_finance
SET consumption_cost = product_cost,
    rule_snapshot = JSON_OBJECT(
      'method', 'general', 'productCost', 'deduct', 'productsIncluded', TRUE, 'staffSplit', split_rule, 'band', NULL,
      'rates', JSON_OBJECT('operations', operations_rate, 'employee', staff_rate, 'profit', profit_rate))
WHERE rule_snapshot IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Where a sale came from, sales recorded for a previous date, voided sales
--    and who last changed a sale. sold_at is the business date of the sale;
--    created_at is when it was entered — two different things.
-- ---------------------------------------------------------------------------
ALTER TABLE sales
  MODIFY status ENUM('completed','refunded','voided') NOT NULL DEFAULT 'completed',
  ADD COLUMN source           ENUM('pos','backdated','import') NOT NULL DEFAULT 'pos' COMMENT 'How it was entered' AFTER status,
  ADD COLUMN is_backdated     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Entered after its business date' AFTER source,
  ADD COLUMN backdate_reason  VARCHAR(255) NULL AFTER is_backdated,
  ADD COLUMN original_sold_at DATETIME     NULL COMMENT 'Business date as first entered' AFTER sold_at,
  ADD COLUMN void_reason      VARCHAR(255) NULL AFTER refunded_by,
  ADD COLUMN voided_at        DATETIME     NULL AFTER void_reason,
  ADD COLUMN voided_by        INT UNSIGNED NULL AFTER voided_at,
  ADD COLUMN updated_by       INT UNSIGNED NULL AFTER voided_by,
  ADD KEY idx_sales_source (branch_id, source, sold_at),
  ADD CONSTRAINT fk_sales_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_sales_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;

UPDATE sales SET source = 'import' WHERE is_imported = 1 AND source = 'pos';
UPDATE sales SET original_sold_at = sold_at WHERE original_sold_at IS NULL;

-- A voided sale is cancelled out: its payments are reversed on the day they
-- were received, and stock taken for it is put back.
ALTER TABLE payments
  MODIFY type ENUM('payment','refund','void') NOT NULL DEFAULT 'payment';
ALTER TABLE inventory_transactions
  MODIFY type ENUM('opening','purchase','sale','refund','adjustment','stock_in','stock_out','damage','internal_use','service_use','void') NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Login sessions end at a fixed time after sign-in, however often they are
--    refreshed (12 hours, or 30 days with "remember me", from .env).
-- ---------------------------------------------------------------------------
ALTER TABLE refresh_tokens
  ADD COLUMN session_started_at DATETIME NULL COMMENT 'Sign-in time of the session (family)' AFTER remember;
UPDATE refresh_tokens SET session_started_at = created_at WHERE session_started_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. The activity log keeps the previous and new values of what changed.
-- ---------------------------------------------------------------------------
ALTER TABLE activity_logs
  ADD COLUMN old_values JSON NULL AFTER metadata,
  ADD COLUMN new_values JSON NULL AFTER old_values;

-- ---------------------------------------------------------------------------
-- 6. Permissions for historical and financial changes, each separate.
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('sales.backdate',      'pos',      'Record sales that happened on a previous date'),
  ('sales.edit_history',  'pos',      'Change the date of past sales and correct sales from previous days'),
  ('sales.void',          'pos',      'Void (delete) sales recorded by mistake'),
  ('sales.correct',       'pos',      'Adjust financial transactions: correct completed services (products used, price, staff) and review low-margin services'),
  ('services.rules',      'services', 'Configure service financial rules (operating cost, staff commission, salon profit)')
ON DUPLICATE KEY UPDATE module = VALUES(module), description = VALUES(description);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE (r.slug = 'super_admin' AND p.code IN ('sales.backdate', 'sales.edit_history', 'sales.void', 'services.rules'))
   OR (r.slug = 'accountant' AND p.code = 'sales.backdate');
