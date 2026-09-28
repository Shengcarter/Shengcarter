'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { getPaging, paginate } = require('../utils/pagination');
const { D, toNumber } = require('../utils/money');
const { localDateRange } = require('../utils/time');
const audit = require('./auditService');

/**
 * Payroll: commission records and salary records.
 *
 * Commissions are created automatically by the POS for every service line.
 * Generating a salary record for a period attaches that period's unpaid
 * commissions. Paying a salary marks the commissions as paid and records the
 * net pay as an expense in the "Salaries" category, so profit reports include it.
 */

async function listCommissions(filters, ctx) {
  const where = ['c.branch_id = ?'];
  const params = [ctx.branchId];
  if (filters.employeeId) {
    where.push('c.employee_id = ?');
    params.push(filters.employeeId);
  }
  if (filters.status) {
    where.push('c.status = ?');
    params.push(filters.status);
  }
  if (filters.from || filters.to) {
    const range = localDateRange(filters.from || '2000-01-01', filters.to || '2999-12-31');
    where.push('c.earned_at >= ? AND c.earned_at < ?');
    params.push(range.start, range.end);
  }
  const from = `FROM commissions c JOIN employees e ON e.id = c.employee_id JOIN sales s ON s.id = c.sale_id
                JOIN sale_items si ON si.id = c.sale_item_id WHERE ${where.join(' AND ')}`;
  const result = await paginate({
    select: `c.id, c.employee_id, e.full_name AS employee_name, c.sale_id, s.invoice_number, si.description AS service_name,
             c.base_amount, c.rate, c.amount, c.status, c.earned_at, c.salary_record_id`,
    from,
    params,
    orderBy: 'c.earned_at DESC, c.id DESC',
    paging: getPaging(filters),
  });
  const summary = await db.queryOne(
    `SELECT COALESCE(SUM(CASE WHEN c.status = 'earned' THEN c.amount END), 0) AS unpaid,
            COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount END), 0) AS paid,
            COALESCE(SUM(CASE WHEN c.status = 'reversed' THEN c.amount END), 0) AS reversed ${from}`,
    params,
  );
  return {
    ...result,
    rows: camelizeRows(result.rows),
    summary: { unpaid: Number(summary.unpaid), paid: Number(summary.paid), reversed: Number(summary.reversed) },
  };
}

async function listSalaryRecords(filters, ctx) {
  const where = ['r.branch_id = ?'];
  const params = [ctx.branchId];
  if (filters.employeeId) {
    where.push('r.employee_id = ?');
    params.push(filters.employeeId);
  }
  if (filters.status) {
    where.push('r.status = ?');
    params.push(filters.status);
  }
  if (filters.periodStart) {
    where.push('r.period_start = ?');
    params.push(filters.periodStart);
  }
  const result = await paginate({
    select: `r.id, r.employee_id, e.full_name AS employee_name, e.job_title, r.period_start, r.period_end, r.base_salary,
             r.commission_amount, r.bonus, r.deductions, r.net_pay, r.status, r.payment_method, r.paid_at, r.notes, r.expense_id,
             (SELECT COUNT(*) FROM commissions c WHERE c.salary_record_id = r.id) AS commission_count`,
    from: `FROM salary_records r JOIN employees e ON e.id = r.employee_id WHERE ${where.join(' AND ')}`,
    params,
    orderBy: 'r.period_start DESC, e.full_name',
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows) };
}

async function getSalaryRecord(id, ctx, conn) {
  const row = await db.queryOne(
    'SELECT r.*, e.full_name AS employee_name FROM salary_records r JOIN employees e ON e.id = r.employee_id WHERE r.id = ?',
    [id],
    conn,
  );
  if (!row || row.branch_id !== ctx.branchId) throw ApiError.notFound('Salary record not found');
  return camelizeRow(row);
}

function netPay({ baseSalary, commissionAmount, bonus, deductions }) {
  const net = D(baseSalary).plus(commissionAmount).plus(bonus || 0).minus(deductions || 0);
  if (net.lessThan(0)) throw ApiError.validation([{ field: 'deductions', message: 'Deductions cannot exceed total earnings' }]);
  return toNumber(net);
}

/**
 * Create pending salary records for a period (one per employee). Unpaid
 * commissions earned within the period are attached to the record.
 */
async function generate({ periodStart, periodEnd, employeeIds }, ctx) {
  const range = localDateRange(periodStart, periodEnd);
  const employees = await db.query(
    `SELECT id, full_name, salary FROM employees WHERE branch_id = ? AND status IN ('active','on_leave') ${employeeIds?.length ? 'AND id IN (?)' : ''}`,
    employeeIds?.length ? [ctx.branchId, employeeIds] : [ctx.branchId],
  );
  const created = [];
  const skipped = [];
  await db.withTransaction(async (conn) => {
    for (const e of employees) {
      const exists = await db.queryOne('SELECT id FROM salary_records WHERE employee_id = ? AND period_start = ?', [e.id, periodStart], conn);
      if (exists) {
        skipped.push(e.full_name);
        continue;
      }
      const commission = await db.queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM commissions
         WHERE employee_id = ? AND branch_id = ? AND status = 'earned' AND salary_record_id IS NULL AND earned_at >= ? AND earned_at < ?`,
        [e.id, ctx.branchId, range.start, range.end],
        conn,
      );
      const values = { baseSalary: e.salary, commissionAmount: Number(commission.total), bonus: 0, deductions: 0 };
      const result = await db.query(
        `INSERT INTO salary_records (employee_id, branch_id, period_start, period_end, base_salary, commission_amount, net_pay, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.id, ctx.branchId, periodStart, periodEnd, values.baseSalary, values.commissionAmount, netPay(values), ctx.userId],
        conn,
      );
      await db.query(
        `UPDATE commissions SET salary_record_id = ?
         WHERE employee_id = ? AND branch_id = ? AND status = 'earned' AND salary_record_id IS NULL AND earned_at >= ? AND earned_at < ?`,
        [result.insertId, e.id, ctx.branchId, range.start, range.end],
        conn,
      );
      created.push(result.insertId);
    }
    await audit.record(ctx, {
      action: 'payroll.generated', entityType: 'salary_record',
      description: `Generated ${created.length} salary record(s) for ${periodStart} to ${periodEnd}`, metadata: { skipped },
    }, conn);
  });
  return { created: created.length, skipped };
}

async function updateRecord(id, data, ctx) {
  const record = await getSalaryRecord(id, ctx);
  if (record.status !== 'pending') throw ApiError.badRequest('Paid salary records cannot be changed');
  const values = {
    baseSalary: data.baseSalary ?? record.baseSalary,
    commissionAmount: record.commissionAmount,
    bonus: data.bonus ?? record.bonus,
    deductions: data.deductions ?? record.deductions,
  };
  await db.query(
    'UPDATE salary_records SET base_salary = ?, bonus = ?, deductions = ?, net_pay = ?, notes = ? WHERE id = ?',
    [values.baseSalary, values.bonus, values.deductions, netPay(values), data.notes !== undefined ? data.notes : record.notes, id],
  );
  await audit.record(ctx, { action: 'payroll.updated', entityType: 'salary_record', entityId: id, description: `Updated salary record of ${record.employeeName}` });
  return getSalaryRecord(id, ctx);
}

async function pay(id, { paymentMethod, paidDate }, ctx) {
  await db.withTransaction(async (conn) => {
    const record = await db.queryOne(
      'SELECT r.*, e.full_name FROM salary_records r JOIN employees e ON e.id = r.employee_id WHERE r.id = ? FOR UPDATE',
      [id],
      conn,
    );
    if (!record || record.branch_id !== ctx.branchId) throw ApiError.notFound('Salary record not found');
    if (record.status === 'paid') throw ApiError.conflict('This salary has already been paid');
    const category = await db.queryOne("SELECT id FROM expense_categories WHERE slug = 'salaries'", [], conn);
    if (!category) throw ApiError.badRequest('The "Salaries" expense category is missing');

    let expenseId = null;
    if (Number(record.net_pay) > 0) {
      const expense = await db.query(
        `INSERT INTO expenses (branch_id, category_id, expense_date, amount, description, payment_method, reference, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ctx.branchId, category.id, paidDate, record.net_pay, `Salary: ${record.full_name} (${record.period_start} to ${record.period_end})`, paymentMethod, `SAL-${record.id}`, ctx.userId],
        conn,
      );
      expenseId = expense.insertId;
    }
    await db.query(
      "UPDATE salary_records SET status = 'paid', payment_method = ?, paid_at = UTC_TIMESTAMP(), expense_id = ? WHERE id = ?",
      [paymentMethod, expenseId, id],
      conn,
    );
    await db.query("UPDATE commissions SET status = 'paid' WHERE salary_record_id = ? AND status = 'earned'", [id], conn);
    await audit.record(ctx, {
      action: 'payroll.paid', entityType: 'salary_record', entityId: id,
      description: `Paid salary of ${record.full_name}: ${record.net_pay} (${paymentMethod})`,
    }, conn);
  });
  return getSalaryRecord(id, ctx);
}

async function removeRecord(id, ctx) {
  const record = await getSalaryRecord(id, ctx);
  if (record.status !== 'pending') throw ApiError.badRequest('Paid salary records cannot be deleted');
  await db.withTransaction(async (conn) => {
    await db.query('UPDATE commissions SET salary_record_id = NULL WHERE salary_record_id = ?', [id], conn);
    await db.query('DELETE FROM salary_records WHERE id = ?', [id], conn);
    await audit.record(ctx, { action: 'payroll.deleted', entityType: 'salary_record', entityId: id, description: `Deleted pending salary record of ${record.employeeName}` }, conn);
  });
}

module.exports = { listCommissions, listSalaryRecords, getSalaryRecord, generate, updateRecord, pay, removeRecord };
