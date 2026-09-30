-- Sales charge exactly the listed price of each service and product: no tax
-- is added. (Tax can still be switched on in Settings -> Financial if the
-- salon registers for VAT; sales made before this change keep their tax.)
UPDATE settings
   SET setting_value = JSON_QUOTE('none')
 WHERE setting_key = 'financial.tax_mode';
