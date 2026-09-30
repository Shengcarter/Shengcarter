-- =============================================================================
-- ZOLA STYLISH MANAGEMENT SYSTEM
-- Reference seed data (safe to run repeatedly).
--
-- Contains roles, permissions, default role permissions, categories, loyalty
-- tiers, the default branch, default settings and document sequences.
--
-- It does NOT create any user account. The Super Admin account is created by
-- `npm run seed` from the ADMIN_EMAIL / ADMIN_PASSWORD environment variables.
-- Demo business data lives in database/demo-data.sql.
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Default branch (single-branch installations work with just this one)
-- -----------------------------------------------------------------------------
INSERT INTO branches (code, name, phone, email, address, is_default, is_active)
SELECT 'MAIN', 'Main Branch', NULL, NULL, 'Dar es Salaam, Tanzania', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM branches);

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
INSERT INTO roles (slug, name, description, is_system) VALUES
  ('super_admin',  'Super Admin',    'Full access to every module, setting and branch.', 1),
  ('receptionist', 'Receptionist',   'Front desk: customers, appointments and point of sale.', 1),
  ('stylist',      'Stylist/Barber', 'Own appointments, check-in and service completion.', 1),
  ('accountant',   'Accountant',     'Sales, payments, expenses, payroll and financial reports.', 1)
ON DUPLICATE KEY UPDATE description = VALUES(description), is_system = 1;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('dashboard.view',           'dashboard',     'View the dashboard'),
  ('customers.view',           'customers',     'View customers and customer history'),
  ('customers.create',         'customers',     'Register customers'),
  ('customers.update',         'customers',     'Edit customers and add notes'),
  ('customers.delete',         'customers',     'Delete customers'),
  ('customers.import',         'customers',     'Import customers from Excel or CSV files'),
  ('appointments.view',        'appointments',  'View all appointments'),
  ('appointments.view_own',    'appointments',  'View appointments assigned to me'),
  ('appointments.create',      'appointments',  'Book appointments'),
  ('appointments.update',      'appointments',  'Edit, reschedule, confirm and mark no-show'),
  ('appointments.cancel',      'appointments',  'Cancel appointments'),
  ('appointments.complete',    'appointments',  'Start and complete services'),
  ('appointments.checkin',     'appointments',  'Check customers in (QR verification)'),
  ('services.view',            'services',      'View services'),
  ('services.manage',          'services',      'Create and edit services and categories'),
  ('employees.view',           'employees',     'View employees'),
  ('employees.manage',         'employees',     'Create and edit employees, schedules and service assignments'),
  ('attendance.view',          'employees',     'View attendance'),
  ('attendance.manage',        'employees',     'Record attendance for any employee'),
  ('attendance.self',          'employees',     'Clock in and out for myself'),
  ('leave.manage',             'employees',     'Record and approve leave'),
  ('payroll.manage',           'employees',     'Manage salary records and pay commissions'),
  ('pos.create',               'pos',           'Use the point of sale and record payments'),
  ('pos.refund',               'pos',           'Refund sales'),
  ('sales.view',               'pos',           'View sales, invoices and payments'),
  ('sales.import',             'pos',           'Import past sales from Excel or CSV files'),
  ('inventory.view',           'inventory',     'View products and stock'),
  ('inventory.manage',         'inventory',     'Manage products and adjust stock'),
  ('suppliers.view',           'suppliers',     'View suppliers'),
  ('suppliers.manage',         'suppliers',     'Manage suppliers and supplier payments'),
  ('purchases.view',           'suppliers',     'View purchases'),
  ('purchases.manage',         'suppliers',     'Create and receive purchases'),
  ('expenses.view',            'expenses',      'View expenses'),
  ('expenses.manage',          'expenses',      'Record and edit expenses'),
  ('loyalty.manage',           'loyalty',       'Configure loyalty and adjust points'),
  ('reports.view',             'reports',       'View operational reports'),
  ('reports.financial',        'reports',       'View financial reports (profit, expenses)'),
  ('reports.export',           'reports',       'Export reports to PDF, Excel and CSV'),
  ('insights.view',            'reports',       'View business insights'),
  ('notifications.send',       'notifications', 'Send messages and promotions to customers'),
  ('settings.manage',          'settings',      'Manage system settings and integrations'),
  ('users.manage',             'settings',      'Manage user accounts'),
  ('roles.manage',             'settings',      'Manage roles and permissions'),
  ('branches.manage',          'settings',      'Manage branches and switch between them'),
  ('audit.view',               'settings',      'View activity logs'),
  ('backups.manage',           'settings',      'Create and download database backups')
ON DUPLICATE KEY UPDATE module = VALUES(module), description = VALUES(description);

-- Super Admin always has every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.slug = 'super_admin';

-- Default permissions for the other system roles are applied only when the
-- role has no permissions yet, so changes made in the UI are never overwritten.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'dashboard.view',
  'customers.view', 'customers.create', 'customers.update', 'customers.import',
  'appointments.view', 'appointments.create', 'appointments.update', 'appointments.cancel',
  'appointments.complete', 'appointments.checkin',
  'services.view', 'employees.view', 'attendance.view', 'attendance.self',
  'pos.create', 'sales.view', 'inventory.view'
)
WHERE r.slug = 'receptionist'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'dashboard.view',
  'appointments.view_own', 'appointments.complete', 'appointments.checkin',
  'services.view', 'attendance.self'
)
WHERE r.slug = 'stylist'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'dashboard.view',
  'customers.view', 'services.view', 'employees.view', 'attendance.view',
  'pos.create', 'pos.refund', 'sales.view', 'sales.import',
  'expenses.view', 'expenses.manage', 'payroll.manage',
  'inventory.view', 'suppliers.view', 'purchases.view',
  'reports.view', 'reports.financial', 'reports.export', 'insights.view'
)
WHERE r.slug = 'accountant'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id);

-- -----------------------------------------------------------------------------
-- Categories
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO service_categories (name, slug, sort_order) VALUES
  ('Haircut', 'haircut', 1),
  ('Hair Styling', 'hair-styling', 2),
  ('Braiding', 'braiding', 3),
  ('Makeup', 'makeup', 4),
  ('Nails', 'nails', 5),
  ('Spa', 'spa', 6),
  ('Massage', 'massage', 7),
  ('Facial', 'facial', 8),
  ('Treatment', 'treatment', 9),
  ('Other', 'other', 10);

INSERT IGNORE INTO expense_categories (name, slug) VALUES
  ('Rent', 'rent'),
  ('Electricity', 'electricity'),
  ('Water', 'water'),
  ('Salaries', 'salaries'),
  ('Supplies', 'supplies'),
  ('Marketing', 'marketing'),
  ('Maintenance', 'maintenance'),
  ('Transport', 'transport'),
  ('Other', 'other');

INSERT IGNORE INTO product_categories (name, slug) VALUES
  ('Hair Care', 'hair-care'),
  ('Hair Extensions', 'hair-extensions'),
  ('Skin Care', 'skin-care'),
  ('Nail Care', 'nail-care'),
  ('Makeup', 'makeup'),
  ('Tools & Accessories', 'tools-accessories'),
  ('Salon Supplies', 'salon-supplies');

-- -----------------------------------------------------------------------------
-- Loyalty tiers (based on lifetime points)
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO loyalty_tiers (name, min_points, points_multiplier, color, benefits) VALUES
  ('Bronze', 0,    1.00, '#CD7F32', 'Earn points on every visit'),
  ('Silver', 500,  1.10, '#C0C0C0', '10% bonus points'),
  ('Gold',   1500, 1.25, '#D4AF37', '25% bonus points'),
  ('VIP',    5000, 1.50, '#F7D7DA', '50% bonus points and priority booking');

-- -----------------------------------------------------------------------------
-- Document sequences
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO sequences (name, current_value) VALUES
  ('invoice', 0), ('receipt', 0), ('customer', 0), ('employee', 0),
  ('appointment', 0), ('purchase', 0);

-- -----------------------------------------------------------------------------
-- Default settings (never overwrites values changed in the UI)
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO settings (setting_key, group_name, setting_value) VALUES
  -- Business
  ('business.salon_name',          'business', JSON_QUOTE('Zola Stylish')),
  ('business.phone',               'business', JSON_QUOTE('')),
  ('business.email',               'business', JSON_QUOTE('')),
  ('business.address',             'business', JSON_QUOTE('Dar es Salaam, Tanzania')),
  ('business.website',             'business', JSON_QUOTE('')),
  ('business.tax_number',          'business', JSON_QUOTE('')),
  ('business.vat_number',          'business', JSON_QUOTE('')),
  ('business.logo',                'business', JSON_QUOTE('')),
  -- Financial
  ('financial.currency_code',      'financial', JSON_QUOTE('TZS')),
  ('financial.currency_decimals',  'financial', CAST('0' AS JSON)),
  ('financial.currency_locale',    'financial', JSON_QUOTE('en-TZ')),
  ('financial.tax_mode',           'financial', JSON_QUOTE('none')),
  ('financial.tax_rate',           'financial', CAST('18' AS JSON)),
  ('financial.tax_label',          'financial', JSON_QUOTE('VAT')),
  ('financial.invoice_prefix',     'financial', JSON_QUOTE('INV-')),
  ('financial.receipt_prefix',     'financial', JSON_QUOTE('RCT-')),
  ('financial.number_padding',     'financial', CAST('6' AS JSON)),
  ('financial.receipt_footer',     'financial', JSON_QUOTE('Thank you for choosing Zola Stylish. We look forward to seeing you again!')),
  ('financial.receipt_format',     'financial', JSON_QUOTE('thermal')),
  ('financial.allow_partial_payments', 'financial', CAST('true' AS JSON)),
  -- System
  ('system.timezone',              'system', JSON_QUOTE('Africa/Dar_es_Salaam')),
  ('system.language',              'system', JSON_QUOTE('en')),
  ('system.default_theme',         'system', JSON_QUOTE('light')),
  ('system.time_format',           'system', JSON_QUOTE('24h')),
  ('system.slot_interval_minutes', 'system', CAST('15' AS JSON)),
  ('system.enforce_working_hours', 'system', CAST('true' AS JSON)),
  ('system.appointment_buffer_minutes', 'system', CAST('0' AS JSON)),
  ('system.business_hours',        'system', CAST('{"0":{"open":false,"start":"10:00","end":"16:00"},"1":{"open":true,"start":"08:00","end":"20:00"},"2":{"open":true,"start":"08:00","end":"20:00"},"3":{"open":true,"start":"08:00","end":"20:00"},"4":{"open":true,"start":"08:00","end":"20:00"},"5":{"open":true,"start":"08:00","end":"21:00"},"6":{"open":true,"start":"08:00","end":"21:00"}}' AS JSON)),
  -- Notifications
  ('notifications.reminders_enabled',     'notifications', CAST('true' AS JSON)),
  ('notifications.reminder_hours_before', 'notifications', CAST('24' AS JSON)),
  ('notifications.channels',       'notifications', CAST('{"appointment_confirmation":["sms"],"appointment_reminder":["sms"],"appointment_cancelled":["sms"],"payment_receipt":[]}' AS JSON)),
  ('notifications.templates',      'notifications', CAST('{"appointment_confirmation":"Hello {{customer_name}}, your appointment at {{salon_name}} is booked for {{date}} at {{time}} with {{stylist}}. Ref: {{code}}.","appointment_reminder":"Reminder: {{customer_name}}, we look forward to seeing you at {{salon_name}} on {{date}} at {{time}}. Ref: {{code}}.","appointment_cancelled":"Hello {{customer_name}}, your appointment {{code}} on {{date}} at {{time}} has been cancelled. Call us to rebook.","payment_receipt":"Thank you {{customer_name}}! We received {{amount}} for invoice {{invoice_number}} at {{salon_name}}."}' AS JSON)),
  -- Integrations (secrets are stored encrypted with is_secret = 1 when set from the UI)
  ('integrations.email_provider',  'integrations', JSON_QUOTE('log')),
  ('integrations.email_from_name', 'integrations', JSON_QUOTE('Zola Stylish')),
  ('integrations.email_from_address', 'integrations', JSON_QUOTE('')),
  ('integrations.smtp_host',       'integrations', JSON_QUOTE('')),
  ('integrations.smtp_port',       'integrations', CAST('587' AS JSON)),
  ('integrations.smtp_secure',     'integrations', CAST('false' AS JSON)),
  ('integrations.smtp_user',       'integrations', JSON_QUOTE('')),
  ('integrations.sms_provider',    'integrations', JSON_QUOTE('log')),
  ('integrations.sms_sender_id',   'integrations', JSON_QUOTE('ZOLA')),
  ('integrations.sms_username',    'integrations', JSON_QUOTE('')),
  ('integrations.twilio_account_sid', 'integrations', JSON_QUOTE('')),
  ('integrations.twilio_from',     'integrations', JSON_QUOTE('')),
  ('integrations.whatsapp_provider', 'integrations', JSON_QUOTE('log')),
  ('integrations.whatsapp_phone_number_id', 'integrations', JSON_QUOTE('')),
  ('integrations.ai_provider',     'integrations', JSON_QUOTE('rule_based')),
  ('integrations.ai_model',        'integrations', JSON_QUOTE('')),
  -- Loyalty
  ('loyalty.enabled',              'loyalty', CAST('true' AS JSON)),
  ('loyalty.earn_amount_unit',     'loyalty', CAST('1000' AS JSON)),
  ('loyalty.points_per_unit',      'loyalty', CAST('1' AS JSON)),
  ('loyalty.redeem_value_per_point', 'loyalty', CAST('10' AS JSON)),
  ('loyalty.min_redeem_points',    'loyalty', CAST('100' AS JSON)),
  ('loyalty.max_redeem_percent',   'loyalty', CAST('50' AS JSON)),
  -- Backups
  ('backup.auto_enabled',          'backup', CAST('true' AS JSON)),
  ('backup.cron',                  'backup', JSON_QUOTE('0 23 * * *')),
  ('backup.retention_count',       'backup', CAST('14' AS JSON));
