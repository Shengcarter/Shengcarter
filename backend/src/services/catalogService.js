'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { contains } = require('../utils/sql');
const audit = require('./auditService');
const serviceFinance = require('./serviceFinanceService');
const serviceRules = require('./serviceRuleService');
const { GENERAL_RULE, normalizeRule } = require('./financialRules');

/**
 * Salon service catalog: categories and services, plus which employees can
 * perform each service (employee_services). Services are shared by all
 * branches; staff assignments decide where they can be booked.
 */
const slugify = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

// ---- Categories -----------------------------------------------------------------
async function listCategories({ includeInactive = true } = {}) {
  return camelizeRows(
    await db.query(
      `SELECT c.id, c.name, c.slug, c.description, c.sort_order, c.is_active,
              (SELECT COUNT(*) FROM services s WHERE s.category_id = c.id) AS service_count
       FROM service_categories c ${includeInactive ? '' : 'WHERE c.is_active = 1'}
       ORDER BY c.sort_order, c.name`,
    ),
  );
}

async function saveCategory(id, data, ctx) {
  const slug = slugify(data.name);
  const categoryId = await db.withTransaction(async (conn) => {
    let targetId = id;
    if (id) {
      const result = await db.query(
        'UPDATE service_categories SET name = ?, slug = ?, description = ?, sort_order = ?, is_active = ? WHERE id = ?',
        [data.name, slug, data.description || null, data.sortOrder ?? 0, data.isActive === false ? 0 : 1, id],
        conn,
      );
      if (!result.affectedRows) throw ApiError.notFound('Category not found');
    } else {
      const result = await db.query(
        'INSERT INTO service_categories (name, slug, description, sort_order, is_active) VALUES (?, ?, ?, ?, ?)',
        [data.name, slug, data.description || null, data.sortOrder ?? 0, data.isActive === false ? 0 : 1],
        conn,
      );
      targetId = result.insertId;
    }
    await audit.record(ctx, { action: id ? 'service_category.updated' : 'service_category.created', entityType: 'service_category', entityId: targetId, description: `Saved service category ${data.name}` }, conn);
    return targetId;
  });
  return camelizeRow(await db.queryOne('SELECT * FROM service_categories WHERE id = ?', [categoryId]));
}

async function deleteCategory(id, ctx) {
  const category = await db.queryOne('SELECT id, name FROM service_categories WHERE id = ?', [id]);
  if (!category) throw ApiError.notFound('Category not found');
  const used = await db.queryOne('SELECT COUNT(*) AS total FROM services WHERE category_id = ?', [id]);
  if (Number(used.total)) throw ApiError.conflict('Move or delete the services in this category first');
  await db.query('DELETE FROM service_categories WHERE id = ?', [id]);
  await audit.record(ctx, { action: 'service_category.deleted', entityType: 'service_category', entityId: id, description: `Deleted service category ${category.name}` });
}

// ---- Services -------------------------------------------------------------------
const SERVICE_COLUMNS = `s.id, s.category_id, s.name, s.description, s.price, s.max_price, s.duration_minutes, s.commission_rate,
  s.is_active, s.is_demo, s.created_at, s.updated_at, c.name AS category_name`;

async function attachEmployees(services, ctx) {
  const branchId = ctx.branchId;
  if (!services.length) return services;
  const rows = await db.query(
    `SELECT es.service_id, e.id, e.full_name, e.calendar_color, e.branch_id
     FROM employee_services es JOIN employees e ON e.id = es.employee_id
     WHERE es.service_id IN (?) AND e.status = 'active' ${branchId ? 'AND e.branch_id = ?' : ''}
     ORDER BY e.full_name`,
    branchId ? [services.map((s) => s.id), branchId] : [services.map((s) => s.id)],
  );
  // The products each service normally uses in this branch, with their expected cost.
  const recipes = branchId ? await serviceFinance.recipesFor(services.map((s) => s.id), branchId) : new Map();
  const rules = await serviceRules.summaries(services.map((s) => s.id), ctx);
  const showCosts = serviceFinance.canSeeCosts(ctx);
  return services.map((s) => {
    const recipe = (recipes.get(s.id) || []).map((r) => (showCosts ? r : { productId: r.productId, name: r.name, unit: r.unit, quantity: r.quantity, inStock: r.inStock }));
    return {
      ...s,
      employees: rows.filter((r) => r.service_id === s.id).map((r) => ({ id: r.id, fullName: r.full_name, calendarColor: r.calendar_color })),
      recipe,
      financialRule: rules.get(s.id) || null,
      ...(showCosts ? { expectedProductCost: recipe.reduce((sum, r) => sum + r.cost, 0) } : {}),
    };
  });
}

async function listServices(filters, ctx) {
  const where = ['1=1'];
  const params = [];
  if (filters.search) {
    where.push('(s.name LIKE ? OR s.description LIKE ?)');
    params.push(contains(filters.search), contains(filters.search));
  }
  if (filters.categoryId) {
    where.push('s.category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.status === 'active') where.push('s.is_active = 1');
  if (filters.status === 'inactive') where.push('s.is_active = 0');
  if (filters.employeeId) {
    where.push('EXISTS (SELECT 1 FROM employee_services es WHERE es.service_id = s.id AND es.employee_id = ?)');
    params.push(filters.employeeId);
  }
  const rows = camelizeRows(
    await db.query(
      `SELECT ${SERVICE_COLUMNS} FROM services s JOIN service_categories c ON c.id = s.category_id
       WHERE ${where.join(' AND ')} ORDER BY c.sort_order, c.name, s.name`,
      params,
    ),
  );
  return attachEmployees(rows, ctx);
}

async function getService(id, ctx) {
  const row = await db.queryOne(`SELECT ${SERVICE_COLUMNS} FROM services s JOIN service_categories c ON c.id = s.category_id WHERE s.id = ?`, [id]);
  if (!row) throw ApiError.notFound('Service not found');
  const [service] = await attachEmployees([camelizeRow(row)], ctx);
  const stats = await db.queryOne(
    `SELECT COUNT(*) AS times_sold, COALESCE(SUM(si.line_total), 0) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE si.service_id = ? AND s.status = 'completed' AND s.sold_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)`,
    [id],
  );
  return { ...service, last30Days: { timesSold: Number(stats.times_sold), revenue: Number(stats.revenue) } };
}

async function assertCategory(categoryId) {
  const category = await db.queryOne('SELECT id FROM service_categories WHERE id = ?', [categoryId]);
  if (!category) throw ApiError.validation([{ field: 'categoryId', message: 'Category does not exist' }]);
}

/** Replace the staff assigned to a service (for employees of the current branch only). */
async function setServiceEmployees(conn, serviceId, employeeIds, branchId) {
  await db.query(
    'DELETE es FROM employee_services es JOIN employees e ON e.id = es.employee_id WHERE es.service_id = ? AND e.branch_id = ?',
    [serviceId, branchId],
    conn,
  );
  if (!employeeIds.length) return;
  const valid = await db.query('SELECT id FROM employees WHERE id IN (?) AND branch_id = ?', [employeeIds, branchId], conn);
  if (valid.length !== new Set(employeeIds).size) {
    throw ApiError.validation([{ field: 'employeeIds', message: 'One or more employees do not belong to this branch' }]);
  }
  await db.query('INSERT IGNORE INTO employee_services (employee_id, service_id) VALUES ?', [valid.map((e) => [e.id, serviceId])], conn);
}

function assertPriceRange(price, maxPrice) {
  if (maxPrice !== null && maxPrice !== undefined && Number(maxPrice) < Number(price)) {
    throw ApiError.validation([{ field: 'maxPrice', message: 'The highest price cannot be lower than the starting price' }]);
  }
}

async function saveService(id, data, ctx) {
  if (data.categoryId) await assertCategory(data.categoryId);
  const duplicate = data.name && (await db.queryOne('SELECT id FROM services WHERE name = ? AND id <> ?', [data.name, id || 0]));
  if (duplicate) throw ApiError.validation([{ field: 'name', message: 'A service with this name already exists' }]);

  const serviceId = await db.withTransaction(async (conn) => {
    let targetId = id;
    if (id) {
      const existing = await db.queryOne('SELECT * FROM services WHERE id = ? FOR UPDATE', [id], conn);
      if (!existing) throw ApiError.notFound('Service not found');
      const price = data.price ?? existing.price;
      const maxPrice = data.maxPrice !== undefined ? data.maxPrice : existing.max_price;
      assertPriceRange(price, maxPrice);
      await db.query(
        `UPDATE services SET category_id = ?, name = ?, description = ?, price = ?, max_price = ?, duration_minutes = ?, commission_rate = ?, is_active = ?
         WHERE id = ?`,
        [
          data.categoryId ?? existing.category_id,
          data.name ?? existing.name,
          data.description !== undefined ? data.description : existing.description,
          price,
          maxPrice,
          data.durationMinutes ?? existing.duration_minutes,
          data.commissionRate !== undefined ? data.commissionRate : existing.commission_rate,
          data.isActive !== undefined ? Number(data.isActive) : existing.is_active,
          id,
        ],
        conn,
      );
      const priceChanged = Number(price) !== Number(existing.price) || Number(maxPrice ?? 0) !== Number(existing.max_price ?? 0);
      await audit.record(ctx, {
        action: 'service.updated', entityType: 'service', entityId: id, description: `Updated service ${data.name ?? existing.name}`,
        metadata: {
          ...(priceChanged ? { oldPrice: existing.price, newPrice: price, oldMaxPrice: existing.max_price, newMaxPrice: maxPrice } : {}),
          ...(data.recipe ? { recipe: data.recipe } : {}),
        },
      }, conn);
    } else {
      assertPriceRange(data.price, data.maxPrice ?? null);
      const result = await db.query(
        `INSERT INTO services (category_id, name, description, price, max_price, duration_minutes, commission_rate, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.categoryId, data.name, data.description || null, data.price, data.maxPrice ?? null, data.durationMinutes, data.commissionRate ?? null, data.isActive === false ? 0 : 1],
        conn,
      );
      targetId = result.insertId;
      // A new service starts on the general formula, as every service did before
      // per-service rules; an administrator can give it its own rule.
      const rule = await db.query(
        'INSERT INTO service_financial_rules (service_id, version, method, config, notes, created_by) VALUES (?, 1, ?, ?, ?, ?)',
        [targetId, GENERAL_RULE.method, JSON.stringify(normalizeRule(GENERAL_RULE)), 'General formula (default for a new service)', ctx.userId],
        conn,
      );
      await db.query('UPDATE services SET financial_rule_id = ? WHERE id = ?', [rule.insertId, targetId], conn);
      await audit.record(ctx, { action: 'service.created', entityType: 'service', entityId: targetId, description: `Created service ${data.name}` }, conn);
    }
    if (data.employeeIds) await setServiceEmployees(conn, targetId, data.employeeIds, ctx.branchId);
    if (data.recipe) await serviceFinance.setRecipe(conn, targetId, data.recipe, ctx.branchId);
    return targetId;
  });
  return getService(serviceId, ctx);
}

/** Services that were ever booked or sold are deactivated instead of deleted. */
async function deleteService(id, ctx) {
  const service = await db.queryOne('SELECT id, name FROM services WHERE id = ?', [id]);
  if (!service) throw ApiError.notFound('Service not found');
  const used = await db.queryOne(
    `SELECT (SELECT COUNT(*) FROM appointment_services WHERE service_id = ?) + (SELECT COUNT(*) FROM sale_items WHERE service_id = ?) AS total`,
    [id, id],
  );
  const archived = Number(used.total) > 0;
  await db.withTransaction(async (conn) => {
    if (archived) await db.query('UPDATE services SET is_active = 0 WHERE id = ?', [id], conn);
    else await db.query('DELETE FROM services WHERE id = ?', [id], conn);
    await audit.record(ctx, {
      action: 'service.deleted', entityType: 'service', entityId: id,
      description: `${archived ? 'Deactivated' : 'Deleted'} service ${service.name}`,
    }, conn);
  });
  return { archived };
}

module.exports = {
  listCategories,
  saveCategory,
  deleteCategory,
  listServices,
  getService,
  saveService,
  deleteService,
  setServiceEmployees,
};
