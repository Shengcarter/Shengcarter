-- =============================================================================
-- ZOLA STYLISH MANAGEMENT SYSTEM
-- DEMO DATA — for evaluation, training and testing only.
--
-- Every row created here is flagged with is_demo = 1 so it can be identified
-- and removed with `npm run demo:clear` before going live.
-- Loaded by `npm run seed` only when SEED_DEMO_DATA=true.
-- =============================================================================

SET NAMES utf8mb4;

SET @branch_id = (SELECT id FROM branches WHERE is_default = 1 ORDER BY id LIMIT 1);

-- -----------------------------------------------------------------------------
-- Services (prices in TZS)
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO services (category_id, name, description, price, duration_minutes, commission_rate, is_demo)
SELECT c.id, s.name, s.description, s.price, s.duration, s.commission, 1
FROM (
  SELECT 'haircut' AS cat, 'Haircut' AS name, 'Classic cut, wash and finish.' AS description, 15000 AS price, 30 AS duration, NULL AS commission
  UNION ALL SELECT 'haircut', 'Kids Haircut', 'Haircut for children under 12.', 8000, 20, NULL
  UNION ALL SELECT 'braiding', 'Braiding', 'Standard braids with customer-supplied or salon hair.', 60000, 180, 18
  UNION ALL SELECT 'braiding', 'Knotless Braids', 'Medium knotless braids, waist length.', 90000, 300, 18
  UNION ALL SELECT 'hair-styling', 'Wash & Blow-dry', 'Shampoo, conditioning and blow-dry styling.', 20000, 45, NULL
  UNION ALL SELECT 'hair-styling', 'Silk Press', 'Heat-protected silk press for natural hair.', 35000, 90, NULL
  UNION ALL SELECT 'makeup', 'Makeup', 'Full-face makeup for day or evening events.', 50000, 60, NULL
  UNION ALL SELECT 'makeup', 'Bridal Makeup', 'Bridal trial-quality makeup with lashes.', 150000, 120, 20
  UNION ALL SELECT 'nails', 'Manicure', 'Nail shaping, cuticle care and polish.', 15000, 45, NULL
  UNION ALL SELECT 'nails', 'Pedicure', 'Foot soak, scrub, nail care and polish.', 20000, 60, NULL
  UNION ALL SELECT 'nails', 'Gel Polish', 'Long-lasting gel polish application.', 25000, 60, NULL
  UNION ALL SELECT 'facial', 'Facial', 'Deep cleansing facial with mask.', 40000, 60, NULL
  UNION ALL SELECT 'massage', 'Massage', 'Relaxing full-body massage.', 60000, 60, NULL
  UNION ALL SELECT 'treatment', 'Hair Treatment', 'Deep conditioning and scalp treatment.', 30000, 45, NULL
  UNION ALL SELECT 'spa', 'Spa Package', 'Facial, massage and pedicure package.', 120000, 150, NULL
) s
JOIN service_categories c ON c.slug = s.cat;

-- -----------------------------------------------------------------------------
-- Employees
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO employees (code, branch_id, full_name, phone, email, address, job_title, employment_date, salary, commission_rate, status, is_bookable, calendar_color, is_demo) VALUES
  ('EMP-0001', @branch_id, 'Neema Mwakyusa', '+255712000101', 'neema.demo@zolastylish.local', 'Sinza, Dar es Salaam', 'Senior Stylist', '2022-03-01', 800000, 15, 'active', 1, '#D4AF37', 1),
  ('EMP-0002', @branch_id, 'Baraka Mushi', '+255712000102', 'baraka.demo@zolastylish.local', 'Kinondoni, Dar es Salaam', 'Barber', '2023-01-15', 600000, 12, 'active', 1, '#60A5FA', 1),
  ('EMP-0003', @branch_id, 'Rehema Said', '+255712000103', 'rehema.demo@zolastylish.local', 'Mwenge, Dar es Salaam', 'Braiding Specialist', '2022-08-10', 650000, 15, 'active', 1, '#F472B6', 1),
  ('EMP-0004', @branch_id, 'Grace Kimaro', '+255712000104', 'grace.demo@zolastylish.local', 'Mikocheni, Dar es Salaam', 'Nail Technician', '2023-06-01', 500000, 10, 'active', 1, '#34D399', 1),
  ('EMP-0005', @branch_id, 'Fatuma Hassan', '+255712000105', 'fatuma.demo@zolastylish.local', 'Upanga, Dar es Salaam', 'Makeup Artist & Beautician', '2021-11-20', 700000, 12, 'active', 1, '#A78BFA', 1),
  ('EMP-0006', @branch_id, 'Joseph Mrema', '+255712000106', 'joseph.demo@zolastylish.local', 'Mbezi, Dar es Salaam', 'Massage Therapist', '2024-02-05', 550000, 10, 'active', 1, '#FB923C', 1),
  ('EMP-0007', @branch_id, 'Zawadi Mollel', '+255712000107', 'zawadi.demo@zolastylish.local', 'Kijitonyama, Dar es Salaam', 'Receptionist', '2023-09-01', 450000, 0, 'active', 0, '#94A3B8', 1);

UPDATE sequences SET current_value = GREATEST(current_value, 7) WHERE name = 'employee';

-- Service assignments
INSERT IGNORE INTO employee_services (employee_id, service_id)
SELECT e.id, s.id FROM employees e JOIN services s
WHERE (e.code = 'EMP-0001' AND s.name IN ('Haircut','Kids Haircut','Wash & Blow-dry','Silk Press','Hair Treatment','Braiding'))
   OR (e.code = 'EMP-0002' AND s.name IN ('Haircut','Kids Haircut'))
   OR (e.code = 'EMP-0003' AND s.name IN ('Braiding','Knotless Braids','Hair Treatment','Wash & Blow-dry'))
   OR (e.code = 'EMP-0004' AND s.name IN ('Manicure','Pedicure','Gel Polish'))
   OR (e.code = 'EMP-0005' AND s.name IN ('Makeup','Bridal Makeup','Facial','Spa Package'))
   OR (e.code = 'EMP-0006' AND s.name IN ('Massage','Spa Package','Facial'));

-- Working schedules (business-local time). Monday-Saturday, Sunday off.
INSERT IGNORE INTO employee_schedules (employee_id, day_of_week, start_time, end_time, is_working)
SELECT e.id, d.dow,
       IF(e.code = 'EMP-0002', '09:00:00', '08:00:00'),
       IF(d.dow IN (5,6), '20:00:00', '18:00:00'),
       IF(d.dow = 0, 0, 1)
FROM employees e
JOIN (SELECT 0 AS dow UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
      UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) d
WHERE e.is_demo = 1;

-- -----------------------------------------------------------------------------
-- Suppliers
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO suppliers (name, contact_person, phone, email, address, tax_number, notes, is_demo) VALUES
  ('Kariakoo Beauty Wholesalers', 'Hamisi Juma', '+255754100201', 'orders.demo@kariakoobeauty.local', 'Kariakoo Market, Dar es Salaam', '123-456-789', 'Hair care and extensions. Delivers on Tuesdays.', 1),
  ('Dar Hair Supplies Ltd', 'Anna Lyimo', '+255754100202', 'sales.demo@darhair.local', 'Samora Avenue, Dar es Salaam', '987-654-321', 'Braiding hair and weaves.', 1),
  ('Mikocheni Salon Equipment', 'Peter Ngowi', '+255754100203', 'info.demo@mikochenisalon.local', 'Mikocheni Industrial Area, Dar es Salaam', '456-789-123', 'Tools, towels and consumables.', 1),
  ('Arusha Natural Cosmetics', 'Esther Laizer', '+255754100204', 'hello.demo@arushanatural.local', 'Njiro, Arusha', '321-654-987', 'Shea butter and natural skin care.', 1);

-- -----------------------------------------------------------------------------
-- Products (stock for the default branch)
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO products (branch_id, category_id, supplier_id, name, sku, barcode, description, unit, purchase_price, selling_price, quantity, min_stock, max_stock, expiry_date, is_retail, is_demo)
SELECT @branch_id, c.id, s.id, p.name, p.sku, p.barcode, p.description, p.unit, p.cost, p.price, p.qty, p.min_stock, p.max_stock, p.expiry, p.retail, 1
FROM (
  SELECT 'hair-care' AS cat, 'Kariakoo Beauty Wholesalers' AS supplier, 'Argan Oil Shampoo 500ml' AS name, 'HC-SHP-500' AS sku, '6201000000011' AS barcode, 'Sulphate-free argan oil shampoo.' AS description, 'bottle' AS unit, 18000 AS cost, 28000 AS price, 24 AS qty, 6 AS min_stock, 48 AS max_stock, DATE_ADD(CURDATE(), INTERVAL 18 MONTH) AS expiry, 1 AS retail
  UNION ALL SELECT 'hair-care', 'Kariakoo Beauty Wholesalers', 'Moisturizing Conditioner 500ml', 'HC-CND-500', '6201000000028', 'Deep moisture conditioner.', 'bottle', 16000, 25000, 20, 6, 48, DATE_ADD(CURDATE(), INTERVAL 18 MONTH), 1
  UNION ALL SELECT 'hair-care', 'Kariakoo Beauty Wholesalers', 'Leave-in Conditioner 250ml', 'HC-LIC-250', '6201000000035', 'Detangling leave-in conditioner.', 'bottle', 12000, 20000, 3, 5, 30, DATE_ADD(CURDATE(), INTERVAL 12 MONTH), 1
  UNION ALL SELECT 'hair-care', 'Kariakoo Beauty Wholesalers', 'Edge Control Gel', 'HC-EDG-100', '6201000000042', 'Strong hold edge control.', 'jar', 5000, 9000, 40, 10, 80, DATE_ADD(CURDATE(), INTERVAL 24 MONTH), 1
  UNION ALL SELECT 'hair-care', 'Arusha Natural Cosmetics', 'Hair Food Pomade', 'HC-PMD-200', '6201000000059', 'Nourishing hair food with castor oil.', 'jar', 4000, 7000, 25, 8, 60, DATE_ADD(CURDATE(), INTERVAL 20 DAY), 1
  UNION ALL SELECT 'hair-extensions', 'Dar Hair Supplies Ltd', 'Braiding Hair (X-pression) Pack', 'HX-BRD-001', '6201000000066', 'Pre-stretched braiding hair, assorted colours.', 'pack', 4500, 8000, 120, 30, 250, NULL, 1
  UNION ALL SELECT 'hair-extensions', 'Dar Hair Supplies Ltd', 'Human Hair Weave 18"', 'HX-WVE-018', '6201000000073', 'Brazilian straight human hair bundle.', 'bundle', 85000, 140000, 6, 2, 15, NULL, 1
  UNION ALL SELECT 'hair-care', 'Kariakoo Beauty Wholesalers', 'Hair Relaxer Kit', 'HC-RLX-001', '6201000000080', 'No-lye relaxer kit, regular strength.', 'kit', 14000, 22000, 8, 4, 20, DATE_ADD(CURDATE(), INTERVAL 10 MONTH), 1
  UNION ALL SELECT 'skin-care', 'Arusha Natural Cosmetics', 'Shea Butter Body Lotion 400ml', 'SC-SHB-400', '6201000000097', 'Pure shea butter body lotion.', 'bottle', 9000, 15000, 15, 5, 40, DATE_ADD(CURDATE(), INTERVAL 14 MONTH), 1
  UNION ALL SELECT 'skin-care', 'Arusha Natural Cosmetics', 'Facial Cleanser 150ml', 'SC-FCL-150', '6201000000103', 'Gentle foaming facial cleanser.', 'tube', 11000, 18000, 2, 4, 20, DATE_ADD(CURDATE(), INTERVAL 9 MONTH), 1
  UNION ALL SELECT 'nail-care', 'Mikocheni Salon Equipment', 'Nail Polish (Assorted)', 'NC-POL-001', '6201000000110', 'Assorted nail polish colours.', 'bottle', 3000, 6000, 50, 12, 100, NULL, 1
  UNION ALL SELECT 'makeup', 'Kariakoo Beauty Wholesalers', 'Liquid Foundation', 'MU-FND-030', '6201000000127', 'Long-wear liquid foundation, 30ml.', 'bottle', 22000, 35000, 10, 3, 25, DATE_ADD(CURDATE(), INTERVAL 16 MONTH), 1
  UNION ALL SELECT 'tools-accessories', 'Mikocheni Salon Equipment', 'Wide-tooth Comb', 'TA-CMB-001', '6201000000134', 'Anti-static wide-tooth comb.', 'pcs', 1500, 3500, 30, 10, 60, NULL, 1
  UNION ALL SELECT 'salon-supplies', 'Mikocheni Salon Equipment', 'Disposable Towels (100 pcs)', 'SS-TWL-100', '6201000000141', 'Single-use salon towels.', 'pack', 12000, 0, 4, 5, 20, NULL, 0
  UNION ALL SELECT 'salon-supplies', 'Mikocheni Salon Equipment', 'Gel Polish Remover 1L', 'SS-GPR-001', '6201000000158', 'Acetone-based gel remover for salon use.', 'bottle', 7000, 0, 10, 3, 20, NULL, 0
) p
JOIN product_categories c ON c.slug = p.cat
JOIN suppliers s ON s.name = p.supplier;

-- Opening stock ledger entries so every unit on hand is auditable.
INSERT INTO inventory_transactions (branch_id, product_id, type, quantity_change, quantity_before, quantity_after, unit_cost, reason)
SELECT p.branch_id, p.id, 'opening', p.quantity, 0, p.quantity, p.purchase_price, 'Opening stock (demo data)'
FROM products p
WHERE p.is_demo = 1
  AND NOT EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.product_id = p.id);

-- -----------------------------------------------------------------------------
-- Customers
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO customers (code, branch_id, full_name, phone, email, gender, date_of_birth, address, notes, marketing_opt_in, preferred_channel, is_demo, created_at) VALUES
  ('CUS-000001', @branch_id, 'Amina Juma',        '+255713200001', 'amina.demo@example.com',   'female', '1992-04-12', 'Masaki, Dar es Salaam', 'Prefers natural hair products. Sensitive scalp.', 1, 'whatsapp', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 150 DAY)),
  ('CUS-000002', @branch_id, 'Halima Mohamed',    '+255713200002', 'halima.demo@example.com',  'female', '1988-09-30', 'Oysterbay, Dar es Salaam', NULL, 1, 'sms', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 140 DAY)),
  ('CUS-000003', @branch_id, 'John Mwita',        '+255713200003', NULL,                       'male',   '1995-01-22', 'Sinza, Dar es Salaam', 'Skin fade, number 1 on the sides.', 1, 'sms', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 130 DAY)),
  ('CUS-000004', @branch_id, 'Mariam Abdallah',   '+255713200004', 'mariam.demo@example.com',  'female', '1990-07-05', 'Upanga, Dar es Salaam', 'Allergic to latex gloves.', 1, 'whatsapp', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 120 DAY)),
  ('CUS-000005', @branch_id, 'Catherine Massawe', '+255713200005', 'catherine.demo@example.com','female','1985-12-18', 'Mikocheni, Dar es Salaam', NULL, 1, 'email', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 110 DAY)),
  ('CUS-000006', @branch_id, 'Emmanuel Kweka',    '+255713200006', NULL,                       'male',   '1993-03-09', 'Kinondoni, Dar es Salaam', NULL, 0, 'none', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 100 DAY)),
  ('CUS-000007', @branch_id, 'Rose Shirima',      '+255713200007', 'rose.demo@example.com',    'female', '1997-06-25', 'Mbezi Beach, Dar es Salaam', 'Bride — wedding in December.', 1, 'whatsapp', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY)),
  ('CUS-000008', @branch_id, 'Saida Omari',       '+255713200008', NULL,                       'female', '2000-11-02', 'Temeke, Dar es Salaam', NULL, 1, 'sms', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 80 DAY)),
  ('CUS-000009', @branch_id, 'David Lema',        '+255713200009', 'david.demo@example.com',   'male',   '1987-08-14', 'Ubungo, Dar es Salaam', NULL, 1, 'sms', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 70 DAY)),
  ('CUS-000010', @branch_id, 'Joyce Minja',       '+255713200010', 'joyce.demo@example.com',   'female', '1991-02-27', 'Kijitonyama, Dar es Salaam', 'Likes knotless braids, medium size.', 1, 'whatsapp', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 DAY)),
  ('CUS-000011', @branch_id, 'Zuhura Ally',       '+255713200011', NULL,                       'female', '1998-05-16', 'Kariakoo, Dar es Salaam', NULL, 1, 'sms', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 50 DAY)),
  ('CUS-000012', @branch_id, 'Peter Swai',        '+255713200012', 'peter.demo@example.com',   'male',   '1989-10-03', 'Mwenge, Dar es Salaam', NULL, 1, 'email', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 40 DAY)),
  ('CUS-000013', @branch_id, 'Agnes Mushi',       '+255713200013', NULL,                       'female', '1994-01-08', 'Tabata, Dar es Salaam', NULL, 1, 'sms', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)),
  ('CUS-000014', @branch_id, 'Khadija Rashid',    '+255713200014', 'khadija.demo@example.com', 'female', '1996-09-21', 'Msasani, Dar es Salaam', NULL, 1, 'whatsapp', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 20 DAY)),
  ('CUS-000015', @branch_id, 'Samuel Mollel',     '+255713200015', NULL,                       'male',   '1999-12-30', 'Kimara, Dar es Salaam', NULL, 1, 'sms', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 12 DAY)),
  ('CUS-000016', @branch_id, 'Winfrida Temba',    '+255713200016', 'winfrida.demo@example.com','female', '1986-04-04', 'Mbagala, Dar es Salaam', NULL, 1, 'sms', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 6 DAY)),
  ('CUS-000017', @branch_id, 'Neema Kileo',       '+255713200017', NULL,                       'female', '2001-07-19', 'Kigamboni, Dar es Salaam', NULL, 1, 'whatsapp', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 DAY)),
  ('CUS-000018', @branch_id, 'Hassan Mfinanga',   '+255713200018', NULL,                       'male',   '1992-02-11', 'Ilala, Dar es Salaam', NULL, 1, 'sms', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY));

UPDATE sequences SET current_value = GREATEST(current_value, 18) WHERE name = 'customer';
