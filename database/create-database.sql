-- =============================================================================
-- ZOLA STYLISH MANAGEMENT SYSTEM — create the database and its user account
--
-- Run ONCE as the MySQL root user, for example:
--   mysql -u root -p < database/create-database.sql
-- or paste it into MySQL Workbench and execute.
--
-- Replace CHANGE_ME with a strong password and put the same password in
-- DATABASE_PASSWORD in the .env file. The tables themselves are created by
-- `npm run setup:db` (or setup.bat).
-- =============================================================================

CREATE DATABASE IF NOT EXISTS zola_stylish CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'zola'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON zola_stylish.* TO 'zola'@'localhost';

-- Optional: only needed to run the automated tests (npm test), which use a
-- separate, throw-away database.
-- GRANT ALL PRIVILEGES ON zola_stylish_test.* TO 'zola'@'localhost';

FLUSH PRIVILEGES;
