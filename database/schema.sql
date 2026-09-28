-- =============================================================================
-- ZOLA STYLISH MANAGEMENT SYSTEM
-- Database schema (MySQL 8.0+)
--
-- Conventions
--   * All DATETIME columns are stored in UTC. The application converts them to
--     the configured business time zone (default Africa/Dar_es_Salaam).
--   * DATE columns (expense_date, work_date, ...) are business-local dates.
--   * Money is stored as DECIMAL(14,2); the API server is authoritative for
--     every financial calculation.
--   * This file is the baseline schema. Incremental changes after the baseline
--     live in database/migrations/ and are applied by `npm run migrate`.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- Branches
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code          VARCHAR(20)  NOT NULL,
  name          VARCHAR(120) NOT NULL,
  phone         VARCHAR(30)  NULL,
  email         VARCHAR(150) NULL,
  address       VARCHAR(255) NULL,
  is_default    TINYINT(1)   NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_branches_code (code),
  UNIQUE KEY uq_branches_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Roles & permissions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug          VARCHAR(50)  NOT NULL,
  name          VARCHAR(80)  NOT NULL,
  description   VARCHAR(255) NULL,
  is_system     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_slug (slug),
  UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code          VARCHAR(80)  NOT NULL,
  module        VARCHAR(50)  NOT NULL,
  description   VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code),
  KEY idx_permissions_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY idx_role_permissions_permission (permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Users & authentication
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id                INT UNSIGNED NOT NULL,
  branch_id              INT UNSIGNED NULL,
  full_name              VARCHAR(120) NOT NULL,
  email                  VARCHAR(150) NOT NULL,
  phone                  VARCHAR(30)  NULL,
  password_hash          VARCHAR(255) NOT NULL,
  avatar                 VARCHAR(255) NULL,
  is_active              TINYINT(1)   NOT NULL DEFAULT 1,
  must_change_password   TINYINT(1)   NOT NULL DEFAULT 0,
  failed_login_attempts  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until           DATETIME     NULL,
  last_login_at          DATETIME     NULL,
  last_login_ip          VARCHAR(45)  NULL,
  password_changed_at    DATETIME     NULL,
  is_demo                TINYINT(1)   NOT NULL DEFAULT 0,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role_id),
  KEY idx_users_branch (branch_id),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED NOT NULL,
  token_hash    CHAR(64)     NOT NULL,
  family_id     CHAR(36)     NOT NULL,
  remember      TINYINT(1)   NOT NULL DEFAULT 0,
  expires_at    DATETIME     NOT NULL,
  revoked_at    DATETIME     NULL,
  ip_address    VARCHAR(45)  NULL,
  user_agent    VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY idx_refresh_tokens_user (user_id),
  KEY idx_refresh_tokens_family (family_id),
  KEY idx_refresh_tokens_expires (expires_at),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED NOT NULL,
  token_hash    CHAR(64)     NOT NULL,
  expires_at    DATETIME     NOT NULL,
  used_at       DATETIME     NULL,
  requested_ip  VARCHAR(45)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_resets_hash (token_hash),
  KEY idx_password_resets_user (user_id),
  CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Customers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code               VARCHAR(20)  NOT NULL,
  branch_id          INT UNSIGNED NULL COMMENT 'Branch where the customer registered',
  full_name          VARCHAR(120) NOT NULL,
  phone              VARCHAR(30)  NOT NULL,
  email              VARCHAR(150) NULL,
  gender             ENUM('female','male','other','unspecified') NOT NULL DEFAULT 'unspecified',
  date_of_birth      DATE         NULL,
  address            VARCHAR(255) NULL,
  photo              VARCHAR(255) NULL,
  notes              TEXT         NULL,
  loyalty_points     INT          NOT NULL DEFAULT 0,
  lifetime_points    INT          NOT NULL DEFAULT 0,
  total_spent        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  visit_count        INT UNSIGNED NOT NULL DEFAULT 0,
  last_visit_at      DATETIME     NULL,
  marketing_opt_in   TINYINT(1)   NOT NULL DEFAULT 1,
  preferred_channel  ENUM('sms','whatsapp','email','none') NOT NULL DEFAULT 'sms',
  is_demo            TINYINT(1)   NOT NULL DEFAULT 0,
  created_by         INT UNSIGNED NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at         DATETIME     NULL,
  -- Phone must be unique among non-deleted customers only.
  phone_active       VARCHAR(30)  GENERATED ALWAYS AS (IF(deleted_at IS NULL, phone, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_code (code),
  UNIQUE KEY uq_customers_phone_active (phone_active),
  KEY idx_customers_phone (phone),
  KEY idx_customers_email (email),
  KEY idx_customers_name (full_name),
  KEY idx_customers_branch (branch_id),
  KEY idx_customers_created (created_at),
  KEY idx_customers_deleted (deleted_at),
  CONSTRAINT fk_customers_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL,
  CONSTRAINT fk_customers_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_customers_points CHECK (loyalty_points >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_notes (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id   INT UNSIGNED NOT NULL,
  note          TEXT         NOT NULL,
  created_by    INT UNSIGNED NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_customer_notes_customer (customer_id, created_at),
  CONSTRAINT fk_customer_notes_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_customer_notes_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Services
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_categories (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(80)  NOT NULL,
  slug          VARCHAR(80)  NOT NULL,
  description   VARCHAR(255) NULL,
  sort_order    SMALLINT     NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_categories_name (name),
  UNIQUE KEY uq_service_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS services (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id       INT UNSIGNED NOT NULL,
  name              VARCHAR(120) NOT NULL,
  description       TEXT         NULL,
  price             DECIMAL(14,2) NOT NULL,
  duration_minutes  SMALLINT UNSIGNED NOT NULL,
  commission_rate   DECIMAL(5,2) NULL COMMENT 'Overrides the employee commission rate when set (percent)',
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  is_demo           TINYINT(1)   NOT NULL DEFAULT 0,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_services_name (name),
  KEY idx_services_category (category_id),
  KEY idx_services_active (is_active),
  CONSTRAINT fk_services_category FOREIGN KEY (category_id) REFERENCES service_categories (id),
  CONSTRAINT chk_services_price CHECK (price >= 0),
  CONSTRAINT chk_services_duration CHECK (duration_minutes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Employees
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code             VARCHAR(20)  NOT NULL,
  branch_id        INT UNSIGNED NOT NULL,
  user_id          INT UNSIGNED NULL,
  full_name        VARCHAR(120) NOT NULL,
  photo            VARCHAR(255) NULL,
  phone            VARCHAR(30)  NULL,
  email            VARCHAR(150) NULL,
  address          VARCHAR(255) NULL,
  job_title        VARCHAR(80)  NOT NULL,
  employment_date  DATE         NULL,
  salary           DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  commission_rate  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  status           ENUM('active','on_leave','inactive','terminated') NOT NULL DEFAULT 'active',
  is_bookable      TINYINT(1)   NOT NULL DEFAULT 1 COMMENT 'Can be assigned to appointments',
  calendar_color   VARCHAR(7)   NOT NULL DEFAULT '#D4AF37',
  notes            TEXT         NULL,
  is_demo          TINYINT(1)   NOT NULL DEFAULT 0,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employees_code (code),
  UNIQUE KEY uq_employees_user (user_id),
  KEY idx_employees_branch_status (branch_id, status),
  KEY idx_employees_name (full_name),
  KEY idx_employees_phone (phone),
  CONSTRAINT fk_employees_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_employees_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_employees_commission CHECK (commission_rate >= 0 AND commission_rate <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_services (
  employee_id   INT UNSIGNED NOT NULL,
  service_id    INT UNSIGNED NOT NULL,
  PRIMARY KEY (employee_id, service_id),
  KEY idx_employee_services_service (service_id),
  CONSTRAINT fk_employee_services_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_services_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_schedules (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id   INT UNSIGNED NOT NULL,
  day_of_week   TINYINT UNSIGNED NOT NULL COMMENT '0 = Sunday ... 6 = Saturday',
  start_time    TIME         NOT NULL,
  end_time      TIME         NOT NULL,
  is_working    TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_schedules_day (employee_id, day_of_week),
  CONSTRAINT fk_employee_schedules_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT chk_employee_schedules_day CHECK (day_of_week BETWEEN 0 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id   INT UNSIGNED NOT NULL,
  branch_id     INT UNSIGNED NOT NULL,
  work_date     DATE         NOT NULL,
  clock_in      DATETIME     NULL,
  clock_out     DATETIME     NULL,
  status        ENUM('present','late','absent','half_day','on_leave') NOT NULL DEFAULT 'present',
  notes         VARCHAR(255) NULL,
  recorded_by   INT UNSIGNED NULL,
  is_demo       TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Generated demo activity (removed by npm run demo:clear)',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_employee_date (employee_id, work_date),
  KEY idx_attendance_branch_date (branch_id, work_date),
  CONSTRAINT fk_attendance_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_attendance_user FOREIGN KEY (recorded_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_records (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id   INT UNSIGNED NOT NULL,
  leave_type    ENUM('annual','sick','maternity','paternity','unpaid','other') NOT NULL,
  start_date    DATE         NOT NULL,
  end_date      DATE         NOT NULL,
  reason        VARCHAR(255) NULL,
  status        ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  reviewed_by   INT UNSIGNED NULL,
  reviewed_at   DATETIME     NULL,
  created_by    INT UNSIGNED NULL,
  is_demo       TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Generated demo activity (removed by npm run demo:clear)',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_leave_employee_dates (employee_id, start_date, end_date),
  KEY idx_leave_status (status),
  CONSTRAINT fk_leave_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_leave_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Appointments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                 VARCHAR(20)  NOT NULL,
  branch_id            INT UNSIGNED NOT NULL,
  customer_id          INT UNSIGNED NOT NULL,
  employee_id          INT UNSIGNED NOT NULL,
  start_time           DATETIME     NOT NULL,
  end_time             DATETIME     NOT NULL,
  status               ENUM('pending','confirmed','in_progress','completed','cancelled','no_show') NOT NULL DEFAULT 'pending',
  source               ENUM('walk_in','phone','whatsapp','online','other') NOT NULL DEFAULT 'phone',
  notes                TEXT         NULL,
  total_price          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_duration       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  qr_token             CHAR(32)     NOT NULL,
  checked_in_at        DATETIME     NULL,
  checked_in_by        INT UNSIGNED NULL,
  confirmed_at         DATETIME     NULL,
  started_at           DATETIME     NULL,
  completed_at         DATETIME     NULL,
  cancelled_at         DATETIME     NULL,
  cancellation_reason  VARCHAR(255) NULL,
  cancelled_by         INT UNSIGNED NULL,
  reminder_sent_at     DATETIME     NULL,
  created_by           INT UNSIGNED NULL,
  is_demo              TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Generated demo activity (removed by npm run demo:clear)',
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_appointments_code (code),
  UNIQUE KEY uq_appointments_qr (qr_token),
  KEY idx_appointments_branch_start (branch_id, start_time),
  KEY idx_appointments_employee_time (employee_id, start_time, end_time),
  KEY idx_appointments_customer (customer_id, start_time),
  KEY idx_appointments_status_start (status, start_time),
  CONSTRAINT fk_appointments_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_appointments_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_appointments_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_appointments_checked_in_by FOREIGN KEY (checked_in_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_appointments_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_appointments_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_appointments_time CHECK (end_time > start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointment_services (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  appointment_id    INT UNSIGNED NOT NULL,
  service_id        INT UNSIGNED NOT NULL,
  service_name      VARCHAR(120) NOT NULL,
  price             DECIMAL(14,2) NOT NULL,
  duration_minutes  SMALLINT UNSIGNED NOT NULL,
  sort_order        SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_appointment_services_appointment (appointment_id),
  KEY idx_appointment_services_service (service_id),
  CONSTRAINT fk_appointment_services_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_appointment_services_service FOREIGN KEY (service_id) REFERENCES services (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Suppliers & products
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(150) NOT NULL,
  contact_person  VARCHAR(120) NULL,
  phone           VARCHAR(30)  NULL,
  email           VARCHAR(150) NULL,
  address         VARCHAR(255) NULL,
  tax_number      VARCHAR(50)  NULL,
  notes           TEXT         NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  is_demo         TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_suppliers_name (name),
  KEY idx_suppliers_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_categories (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(80)  NOT NULL,
  slug          VARCHAR(80)  NOT NULL,
  description   VARCHAR(255) NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_categories_name (name),
  UNIQUE KEY uq_product_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Products are stocked per branch: each branch keeps its own product records
-- and stock levels, so SKU/barcode are unique within a branch.
CREATE TABLE IF NOT EXISTS products (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  branch_id       INT UNSIGNED NOT NULL,
  category_id     INT UNSIGNED NULL,
  supplier_id     INT UNSIGNED NULL,
  name            VARCHAR(150) NOT NULL,
  sku             VARCHAR(60)  NOT NULL,
  barcode         VARCHAR(64)  NULL,
  description     TEXT         NULL,
  unit            VARCHAR(20)  NOT NULL DEFAULT 'pcs',
  purchase_price  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  selling_price   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  quantity        INT          NOT NULL DEFAULT 0,
  min_stock       INT          NOT NULL DEFAULT 5,
  max_stock       INT          NULL,
  expiry_date     DATE         NULL,
  status          ENUM('active','inactive','discontinued') NOT NULL DEFAULT 'active',
  is_retail       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1 = sellable at POS, 0 = salon use only',
  image           VARCHAR(255) NULL,
  is_demo         TINYINT(1)   NOT NULL DEFAULT 0,
  created_by      INT UNSIGNED NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_branch_sku (branch_id, sku),
  UNIQUE KEY uq_products_branch_barcode (branch_id, barcode),
  KEY idx_products_name (name),
  KEY idx_products_category (category_id),
  KEY idx_products_supplier (supplier_id),
  KEY idx_products_branch_status (branch_id, status),
  CONSTRAINT fk_products_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES product_categories (id) ON DELETE SET NULL,
  CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL,
  CONSTRAINT fk_products_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_products_quantity CHECK (quantity >= 0),
  CONSTRAINT chk_products_prices CHECK (purchase_price >= 0 AND selling_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Purchases
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                 VARCHAR(20)  NOT NULL,
  branch_id            INT UNSIGNED NOT NULL,
  supplier_id          INT UNSIGNED NOT NULL,
  supplier_invoice_no  VARCHAR(60)  NULL,
  purchase_date        DATE         NOT NULL,
  status               ENUM('ordered','received','cancelled') NOT NULL DEFAULT 'ordered',
  subtotal             DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_amount      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  tax_amount           DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total                DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  amount_paid          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  payment_status       ENUM('unpaid','partial','paid') NOT NULL DEFAULT 'unpaid',
  notes                TEXT         NULL,
  received_at          DATETIME     NULL,
  received_by          INT UNSIGNED NULL,
  created_by           INT UNSIGNED NULL,
  is_demo              TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Generated demo activity (removed by npm run demo:clear)',
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_purchases_code (code),
  KEY idx_purchases_supplier (supplier_id),
  KEY idx_purchases_branch_date (branch_id, purchase_date),
  KEY idx_purchases_status (status),
  CONSTRAINT fk_purchases_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_purchases_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_purchases_received_by FOREIGN KEY (received_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_purchases_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_items (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  purchase_id   INT UNSIGNED NOT NULL,
  product_id    INT UNSIGNED NOT NULL,
  quantity      INT UNSIGNED NOT NULL,
  unit_cost     DECIMAL(14,2) NOT NULL,
  line_total    DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_purchase_items_purchase (purchase_id),
  KEY idx_purchase_items_product (product_id),
  CONSTRAINT fk_purchase_items_purchase FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE CASCADE,
  CONSTRAINT fk_purchase_items_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_purchase_items_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_payments (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id     INT UNSIGNED NOT NULL,
  purchase_id     INT UNSIGNED NOT NULL,
  branch_id       INT UNSIGNED NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  payment_method  ENUM('cash','mobile_money','card','bank_transfer') NOT NULL,
  payment_date    DATE         NOT NULL,
  reference       VARCHAR(100) NULL,
  notes           VARCHAR(255) NULL,
  created_by      INT UNSIGNED NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_supplier_payments_supplier (supplier_id, payment_date),
  KEY idx_supplier_payments_purchase (purchase_id),
  CONSTRAINT fk_supplier_payments_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_supplier_payments_purchase FOREIGN KEY (purchase_id) REFERENCES purchases (id),
  CONSTRAINT fk_supplier_payments_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_supplier_payments_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_supplier_payments_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Auditable stock ledger: every stock change creates exactly one row.
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  branch_id        INT UNSIGNED NOT NULL,
  product_id       INT UNSIGNED NOT NULL,
  type             ENUM('opening','purchase','sale','refund','adjustment','stock_in','stock_out','damage','internal_use') NOT NULL,
  quantity_change  INT          NOT NULL,
  quantity_before  INT          NOT NULL,
  quantity_after   INT          NOT NULL,
  unit_cost        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  reference_type   VARCHAR(30)  NULL,
  reference_id     INT UNSIGNED NULL,
  reason           VARCHAR(255) NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inventory_tx_product (product_id, created_at),
  KEY idx_inventory_tx_branch (branch_id, created_at),
  KEY idx_inventory_tx_reference (reference_type, reference_id),
  KEY idx_inventory_tx_type (type),
  CONSTRAINT fk_inventory_tx_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_inventory_tx_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_inventory_tx_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Sales (POS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id                       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_number           VARCHAR(30)  NOT NULL,
  receipt_number           VARCHAR(30)  NOT NULL,
  branch_id                INT UNSIGNED NOT NULL,
  customer_id              INT UNSIGNED NULL COMMENT 'NULL = walk-in customer',
  appointment_id           INT UNSIGNED NULL,
  cashier_id               INT UNSIGNED NOT NULL,
  subtotal                 DECIMAL(14,2) NOT NULL,
  discount_type            ENUM('none','amount','percentage') NOT NULL DEFAULT 'none',
  discount_value           DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_amount          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  loyalty_points_redeemed  INT UNSIGNED NOT NULL DEFAULT 0,
  loyalty_discount         DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  tax_mode                 ENUM('exclusive','inclusive','none') NOT NULL DEFAULT 'exclusive',
  tax_rate                 DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  tax_amount               DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total                    DECIMAL(14,2) NOT NULL,
  amount_tendered          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  amount_paid              DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  change_due               DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  balance_due              DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  cost_of_goods            DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  loyalty_points_earned    INT UNSIGNED NOT NULL DEFAULT 0,
  status                   ENUM('completed','refunded') NOT NULL DEFAULT 'completed',
  payment_status           ENUM('paid','partial','unpaid') NOT NULL DEFAULT 'paid',
  notes                    VARCHAR(500) NULL,
  refund_reason            VARCHAR(255) NULL,
  refunded_at              DATETIME     NULL,
  refunded_by              INT UNSIGNED NULL,
  sold_at                  DATETIME     NOT NULL,
  is_demo                  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Generated demo activity (removed by npm run demo:clear)',
  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_invoice (invoice_number),
  UNIQUE KEY uq_sales_receipt (receipt_number),
  KEY idx_sales_branch_sold (branch_id, sold_at),
  KEY idx_sales_customer (customer_id, sold_at),
  KEY idx_sales_cashier (cashier_id),
  KEY idx_sales_status (status, sold_at),
  KEY idx_sales_payment_status (payment_status),
  KEY idx_sales_appointment (appointment_id),
  CONSTRAINT fk_sales_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_sales_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE SET NULL,
  CONSTRAINT fk_sales_cashier FOREIGN KEY (cashier_id) REFERENCES users (id),
  CONSTRAINT fk_sales_refunded_by FOREIGN KEY (refunded_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_sales_amounts CHECK (subtotal >= 0 AND total >= 0 AND balance_due >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_items (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id            INT UNSIGNED NOT NULL,
  item_type          ENUM('service','product') NOT NULL,
  service_id         INT UNSIGNED NULL,
  product_id         INT UNSIGNED NULL,
  employee_id        INT UNSIGNED NULL,
  description        VARCHAR(150) NOT NULL,
  quantity           INT UNSIGNED NOT NULL,
  unit_price         DECIMAL(14,2) NOT NULL,
  unit_cost          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  line_total         DECIMAL(14,2) NOT NULL,
  net_amount         DECIMAL(14,2) NOT NULL COMMENT 'Line total after allocated invoice discounts, before tax',
  commission_rate    DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  commission_amount  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (id),
  KEY idx_sale_items_sale (sale_id),
  KEY idx_sale_items_service (service_id),
  KEY idx_sale_items_product (product_id),
  KEY idx_sale_items_employee (employee_id),
  CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_items_service FOREIGN KEY (service_id) REFERENCES services (id),
  CONSTRAINT fk_sale_items_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_sale_items_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT chk_sale_items_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Refund rows carry a negative amount so SUM(amount) is always net collected.
CREATE TABLE IF NOT EXISTS payments (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id       INT UNSIGNED NOT NULL,
  branch_id     INT UNSIGNED NOT NULL,
  method        ENUM('cash','mobile_money','card','bank_transfer') NOT NULL,
  type          ENUM('payment','refund') NOT NULL DEFAULT 'payment',
  amount        DECIMAL(14,2) NOT NULL,
  reference     VARCHAR(100) NULL,
  received_by   INT UNSIGNED NULL,
  paid_at       DATETIME     NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payments_sale (sale_id),
  KEY idx_payments_branch_paid (branch_id, paid_at),
  KEY idx_payments_method (method),
  CONSTRAINT fk_payments_sale FOREIGN KEY (sale_id) REFERENCES sales (id),
  CONSTRAINT fk_payments_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_payments_user FOREIGN KEY (received_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Expenses
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(80)  NOT NULL,
  slug          VARCHAR(80)  NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expense_categories_name (name),
  UNIQUE KEY uq_expense_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expenses (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  branch_id       INT UNSIGNED NOT NULL,
  category_id     INT UNSIGNED NOT NULL,
  expense_date    DATE         NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  description     VARCHAR(255) NOT NULL,
  payment_method  ENUM('cash','mobile_money','card','bank_transfer') NOT NULL DEFAULT 'cash',
  reference       VARCHAR(100) NULL,
  vendor          VARCHAR(150) NULL,
  attachment      VARCHAR(255) NULL,
  recorded_by     INT UNSIGNED NULL,
  is_demo         TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Generated demo activity (removed by npm run demo:clear)',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_expenses_branch_date (branch_id, expense_date),
  KEY idx_expenses_category (category_id, expense_date),
  CONSTRAINT fk_expenses_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_expenses_category FOREIGN KEY (category_id) REFERENCES expense_categories (id),
  CONSTRAINT fk_expenses_user FOREIGN KEY (recorded_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_expenses_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Payroll: salary records & commissions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salary_records (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id        INT UNSIGNED NOT NULL,
  branch_id          INT UNSIGNED NOT NULL,
  period_start       DATE         NOT NULL,
  period_end         DATE         NOT NULL,
  base_salary        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  commission_amount  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  bonus              DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  deductions         DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  net_pay            DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  status             ENUM('pending','paid') NOT NULL DEFAULT 'pending',
  payment_method     ENUM('cash','mobile_money','card','bank_transfer') NULL,
  paid_at            DATETIME     NULL,
  expense_id         INT UNSIGNED NULL,
  notes              VARCHAR(255) NULL,
  created_by         INT UNSIGNED NULL,
  is_demo            TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Generated demo activity (removed by npm run demo:clear)',
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_salary_employee_period (employee_id, period_start),
  KEY idx_salary_branch_period (branch_id, period_start),
  CONSTRAINT fk_salary_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_salary_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_salary_expense FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE SET NULL,
  CONSTRAINT fk_salary_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS commissions (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id       INT UNSIGNED NOT NULL,
  branch_id         INT UNSIGNED NOT NULL,
  sale_id           INT UNSIGNED NOT NULL,
  sale_item_id      INT UNSIGNED NOT NULL,
  base_amount       DECIMAL(14,2) NOT NULL,
  rate              DECIMAL(5,2) NOT NULL,
  amount            DECIMAL(14,2) NOT NULL,
  status            ENUM('earned','paid','reversed') NOT NULL DEFAULT 'earned',
  salary_record_id  INT UNSIGNED NULL,
  earned_at         DATETIME     NOT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_commissions_sale_item (sale_item_id),
  KEY idx_commissions_employee (employee_id, earned_at),
  KEY idx_commissions_sale (sale_id),
  KEY idx_commissions_status (status),
  CONSTRAINT fk_commissions_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_commissions_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_commissions_sale FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
  CONSTRAINT fk_commissions_sale_item FOREIGN KEY (sale_item_id) REFERENCES sale_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_commissions_salary FOREIGN KEY (salary_record_id) REFERENCES salary_records (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Loyalty
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name               VARCHAR(50)  NOT NULL,
  min_points         INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Lifetime points needed to reach this tier',
  points_multiplier  DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  color              VARCHAR(7)   NOT NULL DEFAULT '#D4AF37',
  benefits           VARCHAR(255) NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_loyalty_tiers_name (name),
  UNIQUE KEY uq_loyalty_tiers_min (min_points)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id    INT UNSIGNED NOT NULL,
  sale_id        INT UNSIGNED NULL,
  type           ENUM('earn','redeem','adjust','reverse') NOT NULL,
  points         INT          NOT NULL,
  balance_after  INT          NOT NULL,
  description    VARCHAR(255) NULL,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_loyalty_tx_customer (customer_id, created_at),
  KEY idx_loyalty_tx_sale (sale_id),
  CONSTRAINT fk_loyalty_tx_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_loyalty_tx_sale FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE SET NULL,
  CONSTRAINT fk_loyalty_tx_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Notifications (in-app) & outbound messages (email / SMS / WhatsApp)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED NOT NULL,
  branch_id     INT UNSIGNED NULL,
  type          VARCHAR(50)  NOT NULL,
  category      ENUM('appointment','inventory','payment','customer','system') NOT NULL DEFAULT 'system',
  title         VARCHAR(150) NOT NULL,
  message       VARCHAR(500) NOT NULL,
  link          VARCHAR(255) NULL,
  data          JSON         NULL,
  read_at       DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_user (user_id, read_at, created_at),
  KEY idx_notifications_created (created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS message_logs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  branch_id      INT UNSIGNED NULL,
  customer_id    INT UNSIGNED NULL,
  channel        ENUM('email','sms','whatsapp') NOT NULL,
  provider       VARCHAR(30)  NULL,
  recipient      VARCHAR(150) NOT NULL,
  subject        VARCHAR(200) NULL,
  body           TEXT         NOT NULL,
  template       VARCHAR(50)  NULL,
  status         ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  attempts       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error     VARCHAR(500) NULL,
  provider_ref   VARCHAR(120) NULL,
  related_type   VARCHAR(30)  NULL,
  related_id     INT UNSIGNED NULL,
  scheduled_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at        DATETIME     NULL,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_message_logs_status (status, scheduled_at),
  KEY idx_message_logs_customer (customer_id),
  KEY idx_message_logs_related (related_type, related_id),
  CONSTRAINT fk_message_logs_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL,
  CONSTRAINT fk_message_logs_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  CONSTRAINT fk_message_logs_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Audit, settings, numbering, backups
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED NULL,
  branch_id     INT UNSIGNED NULL,
  action        VARCHAR(80)  NOT NULL,
  entity_type   VARCHAR(50)  NULL,
  entity_id     INT UNSIGNED NULL,
  description   VARCHAR(500) NULL,
  metadata      JSON         NULL,
  ip_address    VARCHAR(45)  NULL,
  user_agent    VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_user (user_id, created_at),
  KEY idx_activity_entity (entity_type, entity_id),
  KEY idx_activity_action (action),
  KEY idx_activity_created (created_at),
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_activity_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_key    VARCHAR(100) NOT NULL,
  setting_value  JSON         NULL,
  group_name     VARCHAR(50)  NOT NULL,
  is_secret      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Secret values are stored encrypted and never returned by the API',
  updated_by     INT UNSIGNED NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_settings_key (setting_key),
  KEY idx_settings_group (group_name),
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gap-free document numbering (invoices, receipts, codes). Rows are locked
-- with SELECT ... FOR UPDATE inside the business transaction.
CREATE TABLE IF NOT EXISTS sequences (
  name           VARCHAR(50)  NOT NULL,
  current_value  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backups (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename       VARCHAR(255) NOT NULL,
  size_bytes     BIGINT UNSIGNED NULL,
  type           ENUM('manual','scheduled') NOT NULL DEFAULT 'manual',
  status         ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  error          VARCHAR(500) NULL,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_backups_filename (filename),
  CONSTRAINT fk_backups_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version       VARCHAR(100) NOT NULL,
  applied_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
