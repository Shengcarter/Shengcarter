'use strict';

const db = require('../config/database');
const { hasPermission } = require('../middleware/auth');
const { contains, startsWith } = require('../utils/sql');

/**
 * Global search across modules. Each section only runs when the user has
 * permission to view that module, and branch-scoped data is limited to the
 * current branch.
 */
const LIMIT = 5;

async function search(term, ctx) {
  const q = term.trim();
  const user = ctx.user;
  const can = (p) => hasPermission(user, p);
  const tasks = {};

  if (can('customers.view')) {
    tasks.customers = db.query(
      `SELECT id, code, full_name, phone FROM customers
       WHERE deleted_at IS NULL AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR code LIKE ?)
       ORDER BY full_name LIMIT ?`,
      [contains(q), contains(q.replace(/^0/, '')), startsWith(q), startsWith(q), LIMIT],
    ).then((rows) => rows.map((r) => ({ id: r.id, title: r.full_name, subtitle: `${r.phone} · ${r.code}`, link: `/customers/${r.id}` })));
  }

  if (can('appointments.view') || can('appointments.view_own')) {
    const own = !can('appointments.view');
    tasks.appointments = db.query(
      `SELECT a.id, a.code, a.start_time, a.status, c.full_name AS customer, e.full_name AS employee
       FROM appointments a JOIN customers c ON c.id = a.customer_id JOIN employees e ON e.id = a.employee_id
       WHERE a.branch_id = ? AND (a.code LIKE ? OR c.full_name LIKE ? OR c.phone LIKE ?)
         ${own ? 'AND e.user_id = ?' : ''}
       ORDER BY a.start_time DESC LIMIT ?`,
      [ctx.branchId, startsWith(q), contains(q), contains(q), ...(own ? [user.id] : []), LIMIT],
    ).then((rows) => rows.map((r) => ({
      id: r.id,
      title: `${r.code} · ${r.customer}`,
      subtitle: `${r.employee} · ${r.status.replace('_', ' ')}`,
      startTime: r.start_time,
      link: `/appointments?appointment=${r.id}`,
    })));
  }

  if (can('sales.view')) {
    tasks.sales = db.query(
      `SELECT s.id, s.invoice_number, s.receipt_number, s.total, c.full_name AS customer
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.branch_id = ? AND (s.invoice_number LIKE ? OR s.receipt_number LIKE ? OR c.full_name LIKE ?)
       ORDER BY s.sold_at DESC LIMIT ?`,
      [ctx.branchId, contains(q), contains(q), contains(q), LIMIT],
    ).then((rows) => rows.map((r) => ({ id: r.id, title: r.invoice_number, subtitle: `${r.customer || 'Walk-in customer'} · ${r.receipt_number}`, link: `/pos/sales/${r.id}` })));
  }

  if (can('inventory.view')) {
    tasks.products = db.query(
      `SELECT id, name, sku, quantity FROM products
       WHERE branch_id = ? AND (name LIKE ? OR sku LIKE ? OR barcode = ?)
       ORDER BY name LIMIT ?`,
      [ctx.branchId, contains(q), startsWith(q), q, LIMIT],
    ).then((rows) => rows.map((r) => ({ id: r.id, title: r.name, subtitle: `${r.sku} · ${r.quantity} in stock`, link: `/inventory?product=${r.id}` })));
  }

  if (can('services.view')) {
    tasks.services = db.query(
      `SELECT s.id, s.name, c.name AS category FROM services s JOIN service_categories c ON c.id = s.category_id
       WHERE s.name LIKE ? ORDER BY s.name LIMIT ?`,
      [contains(q), LIMIT],
    ).then((rows) => rows.map((r) => ({ id: r.id, title: r.name, subtitle: r.category, link: `/services?service=${r.id}` })));
  }

  if (can('employees.view')) {
    tasks.employees = db.query(
      `SELECT id, code, full_name, job_title FROM employees
       WHERE status <> 'terminated' AND (full_name LIKE ? OR code LIKE ? OR phone LIKE ?)
       ORDER BY full_name LIMIT ?`,
      [contains(q), startsWith(q), contains(q), LIMIT],
    ).then((rows) => rows.map((r) => ({ id: r.id, title: r.full_name, subtitle: `${r.job_title} · ${r.code}`, link: `/employees/${r.id}` })));
  }

  const keys = Object.keys(tasks);
  const values = await Promise.all(Object.values(tasks));
  return Object.fromEntries(keys.map((key, i) => [key, values[i]]));
}

module.exports = { search };
