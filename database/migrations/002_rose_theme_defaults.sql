-- Rose-pink theme defaults.
--
-- The theme is designed light-first, so light becomes the default look for
-- everyone who has not picked light or dark on their own device (a personal
-- choice is stored in the browser and always wins).
UPDATE settings
   SET setting_value = JSON_QUOTE('light')
 WHERE setting_key = 'system.default_theme'
   AND JSON_UNQUOTE(setting_value) = 'dark';

-- New staff calendars and loyalty tiers start in the brand pink. Existing
-- colours (including the seeded Gold tier) are left as they are.
ALTER TABLE employees ALTER COLUMN calendar_color SET DEFAULT '#E3166A';
ALTER TABLE loyalty_tiers ALTER COLUMN color SET DEFAULT '#E3166A';
