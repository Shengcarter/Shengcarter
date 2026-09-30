-- Importing customers and past sales from Excel / CSV files.

-- Imported sales are history: they did not change stock, earn loyalty points
-- or create commission, so a refund of one must not restock products either.
-- The receipt number from the spreadsheet is kept so importing the same file
-- twice does not create the same sales again.
ALTER TABLE sales
  ADD COLUMN is_imported TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Recorded from a spreadsheet import' AFTER is_demo,
  ADD COLUMN import_reference VARCHAR(60) NULL COMMENT 'Receipt number in the imported spreadsheet' AFTER is_imported,
  ADD KEY idx_sales_import_reference (branch_id, import_reference);

INSERT INTO permissions (code, module, description) VALUES
  ('customers.import', 'customers', 'Import customers from Excel or CSV files'),
  ('sales.import',     'pos',       'Import past sales from Excel or CSV files')
ON DUPLICATE KEY UPDATE module = VALUES(module), description = VALUES(description);

-- Super Admin has every permission; the front desk imports customers and
-- the accountant imports sales by default (editable in Roles & permissions).
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON (r.slug = 'super_admin' AND p.code IN ('customers.import', 'sales.import'))
  OR (r.slug = 'receptionist' AND p.code = 'customers.import')
  OR (r.slug = 'accountant' AND p.code = 'sales.import');
