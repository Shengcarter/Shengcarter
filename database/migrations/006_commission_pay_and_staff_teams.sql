-- Commission-only pay, and several staff members on one appointment or service.

-- ---------------------------------------------------------------------------
-- 1. Staff are paid by commission: payroll pays out commission (plus any
--    bonus, minus deductions) and records it under "Staff commissions".
--    The base salary is no longer used; existing values are kept for history.
-- ---------------------------------------------------------------------------
UPDATE IGNORE expense_categories SET name = 'Staff commissions', slug = 'staff_commissions' WHERE slug = 'salaries';
UPDATE permissions SET description = 'Prepare and pay staff commission' WHERE code = 'payroll.manage';

-- ---------------------------------------------------------------------------
-- 2. Appointment teams. appointments.employee_id stays the first (lead)
--    person; every member's time is blocked and the appointment shows in each
--    member's calendar column.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_staff (
  appointment_id  INT UNSIGNED NOT NULL,
  employee_id     INT UNSIGNED NOT NULL,
  sort_order      SMALLINT     NOT NULL DEFAULT 0 COMMENT '0 = lead (appointments.employee_id)',
  PRIMARY KEY (appointment_id, employee_id),
  KEY idx_appointment_staff_employee (employee_id, appointment_id),
  CONSTRAINT fk_appointment_staff_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_appointment_staff_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO appointment_staff (appointment_id, employee_id, sort_order)
SELECT id, employee_id, 0 FROM appointments;

-- ---------------------------------------------------------------------------
-- 3. Staff on a sale line. When several people perform a service, the line's
--    value and its commission are shared equally between them (the shares
--    always add up to the line exactly). sale_items.employee_id stays the
--    first person, for older reports and exports.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_item_staff (
  sale_item_id       INT UNSIGNED NOT NULL,
  employee_id        INT UNSIGNED NOT NULL,
  revenue_share      DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'Equal share of the line net amount',
  commission_amount  DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'This person''s share of the commission',
  sort_order         SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (sale_item_id, employee_id),
  KEY idx_sale_item_staff_employee (employee_id),
  CONSTRAINT fk_sale_item_staff_item FOREIGN KEY (sale_item_id) REFERENCES sale_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_item_staff_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO sale_item_staff (sale_item_id, employee_id, revenue_share, commission_amount, sort_order)
SELECT id, employee_id, net_amount, commission_amount, 0 FROM sale_items WHERE employee_id IS NOT NULL;

-- One commission row per person per line (was one per line).
ALTER TABLE commissions
  ADD UNIQUE KEY uq_commissions_item_employee (sale_item_id, employee_id),
  DROP INDEX uq_commissions_sale_item;
