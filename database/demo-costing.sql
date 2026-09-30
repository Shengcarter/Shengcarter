-- =============================================================================
-- ZOLA STYLISH MANAGEMENT SYSTEM — demo products used on services
-- Salon-use products measured by the ml or gram, and the products each demo
-- service normally uses (its recipe). Loaded with the demo data and safe to
-- run again: existing rows are left as they are.
-- =============================================================================

SET @branch_id = (SELECT id FROM branches WHERE is_default = 1 ORDER BY id LIMIT 1);

-- Salon-use stock: bought by the bottle or tub, used by the ml or gram.
INSERT IGNORE INTO products (branch_id, category_id, supplier_id, name, sku, description, unit, usage_unit, usage_per_unit, purchase_price, selling_price, quantity, min_stock, max_stock, is_retail, is_demo)
SELECT @branch_id, c.id, s.id, p.name, p.sku, p.description, p.unit, p.usage_unit, p.per_unit, p.cost, 0, p.qty, p.min_stock, p.max_stock, 0, 1
FROM (
  SELECT 'salon-supplies' AS cat, 'Kariakoo Beauty Wholesalers' AS supplier, 'Braiding Gel (Salon) 500ml' AS name, 'SS-JEL-500' AS sku, 'Firm-hold braiding gel for the stations.' AS description, 'bottle' AS unit, 'ml' AS usage_unit, 500 AS per_unit, 10000 AS cost, 24 AS qty, 6 AS min_stock, 40 AS max_stock
  UNION ALL SELECT 'salon-supplies', 'Kariakoo Beauty Wholesalers', 'Shampoo (Salon) 5L', 'SS-SHP-5L', 'Professional shampoo for the wash basins.', 'bottle', 'ml', 5000, 45000, 6, 2, 10
  UNION ALL SELECT 'salon-supplies', 'Kariakoo Beauty Wholesalers', 'Conditioner (Salon) 5L', 'SS-CND-5L', 'Professional conditioner for the wash basins.', 'bottle', 'ml', 5000, 50000, 6, 2, 10
  UNION ALL SELECT 'salon-supplies', 'Arusha Natural Cosmetics', 'Edge Control (Salon) 500g', 'SS-EDG-500', 'Salon tub of edge control.', 'tub', 'g', 500, 15000, 10, 3, 16
  UNION ALL SELECT 'salon-supplies', 'Arusha Natural Cosmetics', 'Hair Oil (Salon) 1L', 'SS-OIL-1L', 'Light finishing oil.', 'bottle', 'ml', 1000, 18000, 8, 2, 12
) p
JOIN product_categories c ON c.slug = p.cat
JOIN suppliers s ON s.name = p.supplier;

-- The gel polish remover is used by the ml.
UPDATE products SET usage_unit = 'ml', usage_per_unit = 1000
WHERE is_demo = 1 AND sku = 'SS-GPR-001' AND usage_unit IS NULL;

INSERT INTO inventory_transactions (branch_id, product_id, type, quantity_change, quantity_before, quantity_after, unit_cost, reason)
SELECT p.branch_id, p.id, 'opening', p.quantity, 0, p.quantity, p.purchase_price, 'Opening stock (demo data)'
FROM products p
WHERE p.is_demo = 1
  AND NOT EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.product_id = p.id);

-- What each demo service normally uses (quantities in the usage unit).
INSERT IGNORE INTO service_products (service_id, product_id, quantity)
SELECT s.id, p.id, r.quantity
FROM (
  SELECT 'Braiding' AS service, 'HX-BRD-001' AS sku, 4 AS quantity
  UNION ALL SELECT 'Braiding', 'SS-JEL-500', 80
  UNION ALL SELECT 'Braiding', 'SS-EDG-500', 10
  UNION ALL SELECT 'Knotless Braids', 'HX-BRD-001', 6
  UNION ALL SELECT 'Knotless Braids', 'SS-JEL-500', 100
  UNION ALL SELECT 'Knotless Braids', 'SS-EDG-500', 15
  UNION ALL SELECT 'Wash & Blow-dry', 'SS-SHP-5L', 30
  UNION ALL SELECT 'Wash & Blow-dry', 'SS-CND-5L', 30
  UNION ALL SELECT 'Wash & Blow-dry', 'SS-OIL-1L', 5
  UNION ALL SELECT 'Silk Press', 'SS-SHP-5L', 30
  UNION ALL SELECT 'Silk Press', 'SS-CND-5L', 30
  UNION ALL SELECT 'Silk Press', 'SS-OIL-1L', 10
  UNION ALL SELECT 'Hair Treatment', 'SS-CND-5L', 60
  UNION ALL SELECT 'Hair Treatment', 'SS-OIL-1L', 10
  UNION ALL SELECT 'Haircut', 'SS-SHP-5L', 20
  UNION ALL SELECT 'Gel Polish', 'SS-GPR-001', 20
) r
JOIN services s ON s.name = r.service AND s.is_demo = 1
JOIN products p ON p.sku = r.sku AND p.branch_id = @branch_id AND p.is_demo = 1;
