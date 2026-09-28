'use strict';

/**
 * Test environment. The suite runs against its own database
 * (TEST_DATABASE_NAME, default "zola_stylish_test"), which is dropped and
 * recreated on every run — never point it at a database with real data.
 * The database user from .env (or DATABASE_USER / DATABASE_PASSWORD) needs
 * permission to create and drop that database.
 */
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_NAME = process.env.TEST_DATABASE_NAME || 'zola_stylish_test';
process.env.JWT_SECRET = process.env.TEST_JWT_SECRET || 'test-only-secret-7f3c9a1e5b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a';
process.env.JOBS_ENABLED = 'false';
process.env.LOG_LEVEL = 'silent';
process.env.BCRYPT_ROUNDS = '4';
process.env.ADMIN_NAME = 'Test Administrator';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'TestAdmin2026!';
process.env.SEED_DEMO_DATA = 'true';
process.env.SEED_DEMO_ACTIVITY = 'false';
process.env.DEMO_PASSWORD = 'TestDemo2026!';
process.env.AI_PROVIDER = '';
process.env.AI_API_KEY = '';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'zola-test', 'uploads');
process.env.BACKUP_DIR = path.join(os.tmpdir(), 'zola-test', 'backups');
process.env.LOG_FILE = '';
process.env.COOKIE_SECURE = 'false';
