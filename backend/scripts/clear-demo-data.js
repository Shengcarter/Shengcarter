'use strict';

/**
 * Remove the demo data from ZOLA STYLISH MANAGEMENT SYSTEM.
 *
 * Deletes the generated demo activity (rows flagged is_demo = 1: appointments,
 * sales, purchases, expenses, payroll, attendance, leave) and the demo records
 * loaded from database/demo-data.sql (customers, staff, services, products,
 * suppliers and the demo user accounts). Reference data, settings, your own
 * records and the Super Admin are kept.
 *
 * Safety: if any of your own records use a demo record (for example a real
 * sale of a demo product), nothing is deleted and the blocking records are
 * listed, so stock and financial history can never become inconsistent.
 *
 * Usage: npm run demo:clear -- --yes
 */
const readline = require('readline');
const { connect } = require('./lib/db');

const BLOCKERS = [
  ['sales for demo customers', 'SELECT COUNT(*) AS n FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.is_demo = 0 AND c.is_demo = 1'],
  ['sale lines using demo services, products or staff', `SELECT COUNT(*) AS n FROM sale_items i JOIN sales s ON s.id = i.sale_id
     WHERE s.is_demo = 0 AND (i.service_id IN (SELECT id FROM services WHERE is_demo = 1)
       OR i.product_id IN (SELECT id FROM products WHERE is_demo = 1)
       OR i.employee_id IN (SELECT id FROM employees WHERE is_demo = 1))`],
  ['appointments with demo customers, staff or services', `SELECT COUNT(*) AS n FROM appointments a WHERE a.is_demo = 0 AND (
       a.customer_id IN (SELECT id FROM customers WHERE is_demo = 1)
       OR a.employee_id IN (SELECT id FROM employees WHERE is_demo = 1)
       OR EXISTS (SELECT 1 FROM appointment_services x JOIN services v ON v.id = x.service_id WHERE x.appointment_id = a.id AND v.is_demo = 1))`],
  ['purchases from demo suppliers or of demo products', `SELECT COUNT(*) AS n FROM purchases p WHERE p.is_demo = 0 AND (
       p.supplier_id IN (SELECT id FROM suppliers WHERE is_demo = 1)
       OR EXISTS (SELECT 1 FROM purchase_items i JOIN products d ON d.id = i.product_id WHERE i.purchase_id = p.id AND d.is_demo = 1))`],
  ['salary records of demo staff', 'SELECT COUNT(*) AS n FROM salary_records r JOIN employees e ON e.id = r.employee_id WHERE r.is_demo = 0 AND e.is_demo = 1'],
];

async function confirm() {
  if (process.argv.includes('--yes')) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question('Delete ALL demo data from this database? Type "yes" to continue: ', resolve));
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function ids(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows.map((r) => r.id);
}

async function run(conn, sql, params = []) {
  const [result] = await conn.query(sql, params);
  return result.affectedRows || 0;
}

async function clearDemoData() {
  const conn = await connect();
  try {
    const [[{ demo }]] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM customers WHERE is_demo = 1) + (SELECT COUNT(*) FROM services WHERE is_demo = 1)
            + (SELECT COUNT(*) FROM sales WHERE is_demo = 1) + (SELECT COUNT(*) FROM users WHERE is_demo = 1) AS demo`,
    );
    if (!Number(demo)) {
      console.log('• No demo data found — nothing to do.');
      return;
    }

    const blocking = [];
    for (const [label, sql] of BLOCKERS) {
      const [[{ n }]] = await conn.query(sql);
      if (Number(n)) blocking.push(`  – ${n} ${label}`);
    }
    if (blocking.length) {
      console.error('✖ Demo data was NOT removed: some of your own records use demo records:');
      console.error(blocking.join('\n'));
      console.error('  Delete or change those records first, or keep the demo data.');
      process.exitCode = 1;
      return;
    }

    if (!(await confirm())) {
      console.log('• Cancelled. Run "npm run demo:clear -- --yes" to skip this question.');
      return;
    }

    await conn.beginTransaction();
    const removed = {};
    try {
      // Demo sales and everything they produced.
      const saleIds = await ids(conn, 'SELECT id FROM sales WHERE is_demo = 1');
      if (saleIds.length) {
        await run(conn, 'DELETE FROM loyalty_transactions WHERE sale_id IN (?)', [saleIds]);
        await run(conn, "DELETE FROM inventory_transactions WHERE reference_type = 'sale' AND reference_id IN (?)", [saleIds]);
        await run(conn, 'DELETE FROM payments WHERE sale_id IN (?)', [saleIds]);
        await run(conn, 'DELETE FROM commissions WHERE sale_id IN (?)', [saleIds]);
        await run(conn, "DELETE FROM message_logs WHERE related_type = 'sale' AND related_id IN (?)", [saleIds]);
      }
      removed.sales = await run(conn, 'DELETE FROM sales WHERE is_demo = 1');

      // Demo purchases.
      const purchaseIds = await ids(conn, 'SELECT id FROM purchases WHERE is_demo = 1');
      if (purchaseIds.length) {
        await run(conn, 'DELETE FROM supplier_payments WHERE purchase_id IN (?)', [purchaseIds]);
        await run(conn, "DELETE FROM inventory_transactions WHERE reference_type = 'purchase' AND reference_id IN (?)", [purchaseIds]);
      }
      removed.purchases = await run(conn, 'DELETE FROM purchases WHERE is_demo = 1');

      // Payroll, expenses, staff records, appointments.
      removed.salaryRecords = await run(conn, 'DELETE FROM salary_records WHERE is_demo = 1');
      removed.expenses = await run(conn, 'DELETE FROM expenses WHERE is_demo = 1');
      removed.attendance = await run(conn, 'DELETE FROM attendance WHERE is_demo = 1');
      removed.leave = await run(conn, 'DELETE FROM leave_records WHERE is_demo = 1');
      const appointmentIds = await ids(conn, 'SELECT id FROM appointments WHERE is_demo = 1');
      if (appointmentIds.length) await run(conn, "DELETE FROM message_logs WHERE related_type = 'appointment' AND related_id IN (?)", [appointmentIds]);
      removed.appointments = await run(conn, 'DELETE FROM appointments WHERE is_demo = 1');

      // Demo master data (nothing of yours references it — checked above).
      await run(conn, 'DELETE FROM inventory_transactions WHERE product_id IN (SELECT id FROM products WHERE is_demo = 1)');
      removed.products = await run(conn, 'DELETE FROM products WHERE is_demo = 1');
      removed.suppliers = await run(conn, 'DELETE FROM suppliers WHERE is_demo = 1');
      await run(conn, 'DELETE FROM commissions WHERE employee_id IN (SELECT id FROM employees WHERE is_demo = 1)');
      removed.employees = await run(conn, 'DELETE FROM employees WHERE is_demo = 1');
      removed.services = await run(conn, 'DELETE FROM services WHERE is_demo = 1');
      await run(conn, 'DELETE FROM message_logs WHERE customer_id IN (SELECT id FROM customers WHERE is_demo = 1)');
      removed.customers = await run(conn, 'DELETE FROM customers WHERE is_demo = 1');

      // Demo logins: delete, or deactivate when your own sales name them as cashier.
      const keepUsers = await ids(conn, 'SELECT DISTINCT u.id FROM users u JOIN sales s ON s.cashier_id = u.id WHERE u.is_demo = 1');
      if (keepUsers.length) await run(conn, 'UPDATE users SET is_active = 0 WHERE id IN (?)', [keepUsers]);
      removed.users = await run(conn, `DELETE FROM users WHERE is_demo = 1${keepUsers.length ? ' AND id NOT IN (?)' : ''}`, keepUsers.length ? [keepUsers] : []);
      await run(conn, "DELETE FROM activity_logs WHERE action = 'demo.generated'");

      // Start document numbering again where a table is now empty.
      const resets = [['invoice', 'sales'], ['receipt', 'sales'], ['appointment', 'appointments'], ['purchase', 'purchases'], ['customer', 'customers'], ['employee', 'employees']];
      for (const [sequence, table] of resets) {
        const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM ${table}`);
        if (!Number(n)) await run(conn, 'UPDATE sequences SET current_value = 0 WHERE name = ?', [sequence]);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    }

    console.log('✔ Demo data removed:');
    for (const [key, count] of Object.entries(removed)) if (count) console.log(`  – ${key}: ${count}`);
    console.log('  Set SEED_DEMO_DATA=false in .env so demo data is not loaded again.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  clearDemoData()
    .then(() => process.exit(process.exitCode || 0))
    .catch((error) => {
      console.error(`✖ Could not remove demo data: ${error.message}`);
      process.exit(1);
    });
}

module.exports = clearDemoData;
