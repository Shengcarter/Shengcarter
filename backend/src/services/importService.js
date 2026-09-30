'use strict';

const ExcelJS = require('exceljs');
const db = require('../config/database');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const audit = require('./auditService');
const settings = require('./settingsService');
const customerModel = require('../models/customerModel');
const { createCustomer } = require('../validators/customerValidators');
const { normalizePhone } = require('../utils/phone');
const { nextCode } = require('../utils/sequence');
const { D, round, toNumber } = require('../utils/money');
const { parseDateTime, todayLocal } = require('../utils/time');
const { nextDocumentNumbers } = require('./salesService');
const { parseSpreadsheet, text, number, boolean, dateTime, timeOfDay } = require('./imports/spreadsheet');

/**
 * Importing records from Excel (.xlsx) or CSV files.
 *
 * Every import runs in two steps over the same file: `preview` reads and
 * checks every row without saving anything; `run` checks again and saves the
 * rows that are ready, all in ONE transaction (all or nothing). Rows with
 * problems block the import unless the user chooses to skip them.
 *
 *   customers — rows are checked like the "New customer" form; phone numbers
 *               already registered (or repeated in the file) are skipped.
 *   sales     — past sales recorded elsewhere. Rows sharing a receipt number
 *               form one sale. Imported sales record exactly the amounts in
 *               the file and count in reports and customer history, but do
 *               not change stock, earn loyalty points or create commission
 *               (that already happened outside the system).
 */

const COUNTRY_CODE = '255';

const fail = (messages) => ({ status: 'error', messages });
const label = (columns, key) => columns.find((c) => c.key === key)?.label || key;

// ---- Customers --------------------------------------------------------------------------

const CUSTOMER_COLUMNS = [
  { key: 'fullName', label: 'Full name', required: true, width: 26, aliases: ['name', 'customer', 'customer name', 'client', 'client name', 'jina', 'jina kamili'] },
  { key: 'phone', label: 'Phone', required: true, width: 18, aliases: ['phone number', 'mobile', 'mobile number', 'telephone', 'tel', 'simu', 'namba ya simu', 'contact'] },
  { key: 'email', label: 'Email', width: 26, aliases: ['email address', 'e-mail', 'barua pepe'] },
  { key: 'gender', label: 'Gender', width: 12, aliases: ['sex', 'jinsia'] },
  { key: 'dateOfBirth', label: 'Birthday', width: 14, aliases: ['date of birth', 'dob', 'birth date', 'birthdate', 'tarehe ya kuzaliwa'] },
  { key: 'address', label: 'Address', width: 26, aliases: ['location', 'area', 'town', 'city', 'anwani', 'mahali'] },
  { key: 'notes', label: 'Notes', width: 30, aliases: ['note', 'comments', 'comment', 'maelezo'] },
  { key: 'marketingOptIn', label: 'Promotions', width: 12, aliases: ['marketing', 'marketing opt in', 'opt in', 'receives promotions', 'promos'] },
  { key: 'preferredChannel', label: 'Contact via', width: 14, aliases: ['preferred channel', 'channel', 'contact method', 'preferred contact'] },
];

const GENDERS = {
  female: ['female', 'f', 'woman', 'lady', 'mwanamke', 'kike', 'ke'],
  male: ['male', 'm', 'man', 'mwanaume', 'kiume', 'me'],
  other: ['other', 'others'],
};
const CHANNELS = { sms: ['sms', 'text', 'message', 'ujumbe'], whatsapp: ['whatsapp', 'whats app', 'wa'], email: ['email', 'e-mail', 'mail'], none: ['none', 'no', 'hakuna'] };

function lookupWord(map, value) {
  const v = String(value).trim().toLowerCase();
  return Object.keys(map).find((key) => map[key].includes(v)) || null;
}

async function analyseCustomers(rows) {
  const phones = new Map();
  const checked = rows.map(({ rowNumber, values: v }) => {
    const messages = [];
    const input = {
      fullName: text(v.fullName),
      phone: text(v.phone),
      email: text(v.email),
      address: text(v.address),
      notes: text(v.notes),
    };
    if (v.gender !== null && v.gender !== undefined) {
      const g = lookupWord(GENDERS, v.gender);
      if (g) input.gender = g;
      else messages.push(`Gender "${v.gender}" is not recognised (use Female, Male or Other).`);
    }
    if (v.dateOfBirth !== null && v.dateOfBirth !== undefined) {
      const d = dateTime(v.dateOfBirth);
      if (d) input.dateOfBirth = d.date;
      else messages.push(`Birthday "${text(v.dateOfBirth)}" is not a date (use for example 25/12/1990).`);
    }
    if (v.marketingOptIn !== null && v.marketingOptIn !== undefined) {
      const b = boolean(v.marketingOptIn);
      if (b === null) messages.push('Promotions must be Yes or No.');
      else input.marketingOptIn = b;
    }
    if (v.preferredChannel !== null && v.preferredChannel !== undefined) {
      const c = lookupWord(CHANNELS, v.preferredChannel);
      if (c) input.preferredChannel = c;
      else messages.push(`Contact via "${v.preferredChannel}" is not recognised (use SMS, WhatsApp, Email or None).`);
    }
    const parsed = createCustomer.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) messages.push(`${label(CUSTOMER_COLUMNS, issue.path[0])}: ${issue.message}`);
    }
    const data = parsed.success ? { ...parsed.data, phone: normalizePhone(parsed.data.phone, COUNTRY_CODE) } : null;
    const display = { fullName: input.fullName || '', phone: data?.phone || input.phone || '', email: input.email || '' };
    if (messages.length) return { rowNumber, ...fail(messages), display };
    if (phones.has(data.phone)) {
      return { rowNumber, status: 'skip', messages: [`Same phone number as row ${phones.get(data.phone)} of this file.`], display };
    }
    phones.set(data.phone, rowNumber);
    return { rowNumber, status: 'ready', messages: [], display, data };
  });

  const ready = checked.filter((r) => r.status === 'ready');
  if (ready.length) {
    const existing = await db.query(
      'SELECT phone, full_name, code FROM customers WHERE phone IN (?) AND deleted_at IS NULL',
      [ready.map((r) => r.data.phone)],
    );
    const byPhone = new Map(existing.map((c) => [c.phone, c]));
    for (const row of ready) {
      const found = byPhone.get(row.data.phone);
      if (found) {
        row.status = 'skip';
        row.messages = [`Already registered as ${found.full_name} (${found.code}).`];
      }
    }
  }
  return { rows: checked, summary: { newCustomers: checked.filter((r) => r.status === 'ready').length } };
}

async function saveCustomers(analysis, ctx) {
  const ready = analysis.rows.filter((r) => r.status === 'ready');
  await db.withTransaction(async (conn) => {
    for (const row of ready) {
      const code = await nextCode(conn, 'customer', 'CUS-', 6);
      await customerModel.insert({ ...row.data, code, branchId: ctx.branchId, createdBy: ctx.userId }, conn);
    }
    await audit.record(ctx, {
      action: 'customers.imported', entityType: 'customer',
      description: `Imported ${ready.length} customer${ready.length === 1 ? '' : 's'} from ${analysis.fileName}`,
      metadata: { file: analysis.fileName, imported: ready.length, skipped: analysis.summary.skipped, errors: analysis.summary.errors },
    }, conn);
  });
  return { imported: ready.length };
}

// ---- Sales ------------------------------------------------------------------------------

const SALE_COLUMNS = [
  { key: 'date', label: 'Date', required: true, width: 13, aliases: ['sale date', 'date sold', 'day', 'tarehe'] },
  { key: 'time', label: 'Time', width: 9, aliases: ['sale time', 'saa', 'muda'] },
  { key: 'receipt', label: 'Receipt no', width: 13, aliases: ['receipt', 'receipt number', 'invoice', 'invoice no', 'invoice number', 'reference', 'ref', 'sale no', 'sale number', 'risiti', 'namba ya risiti'] },
  { key: 'customerPhone', label: 'Customer phone', width: 17, aliases: ['phone', 'phone number', 'mobile', 'client phone', 'simu', 'simu ya mteja'] },
  { key: 'customerName', label: 'Customer name', width: 22, aliases: ['customer', 'client', 'client name', 'name', 'mteja', 'jina la mteja'] },
  { key: 'type', label: 'Type', width: 10, aliases: ['item type', 'kind', 'category type', 'aina'] },
  { key: 'item', label: 'Item', required: true, width: 26, aliases: ['service', 'product', 'service or product', 'service/product', 'description', 'item name', 'huduma', 'bidhaa'] },
  { key: 'staff', label: 'Staff', width: 20, aliases: ['stylist', 'barber', 'employee', 'staff member', 'done by', 'served by', 'mfanyakazi', 'msusi'] },
  { key: 'quantity', label: 'Quantity', width: 10, aliases: ['qty', 'quantity sold', 'units', 'idadi'] },
  { key: 'amount', label: 'Amount', width: 13, aliases: ['total', 'price', 'amount paid', 'line total', 'paid', 'value', 'kiasi', 'bei'] },
  { key: 'paymentMethod', label: 'Payment method', width: 16, aliases: ['payment', 'paid by', 'method', 'payment type', 'njia ya malipo', 'malipo'] },
  { key: 'notes', label: 'Notes', width: 26, aliases: ['note', 'comments', 'comment', 'maelezo'] },
];

const PAYMENT_METHODS = {
  cash: ['cash', 'taslimu', 'pesa taslimu'],
  mobile_money: ['mobile money', 'mobile', 'm-pesa', 'mpesa', 'm pesa', 'tigo pesa', 'tigopesa', 'mixx', 'mixx by yas', 'airtel money', 'airtelmoney', 'halopesa', 'halo pesa', 'ttcl pesa', 'lipa namba', 'mobile_money'],
  card: ['card', 'credit card', 'debit card', 'visa', 'mastercard', 'pos', 'kadi'],
  bank_transfer: ['bank', 'bank transfer', 'transfer', 'bank_transfer', 'benki'],
};
const TYPES = { service: ['service', 'services', 'huduma'], product: ['product', 'products', 'bidhaa', 'item', 'retail'] };

async function saleLookups(branchId) {
  const [services, products, employees] = await Promise.all([
    // Inactive items too: past sales may include services or products no longer offered.
    db.query('SELECT id, name, price FROM services'),
    db.query('SELECT id, name, sku, barcode, selling_price, purchase_price FROM products WHERE branch_id = ?', [branchId]),
    db.query("SELECT id, code, full_name FROM employees WHERE branch_id = ? AND status <> 'terminated'", [branchId]),
  ]);
  const key = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const index = (list, ...fields) => {
    const map = new Map();
    for (const item of list) for (const f of fields) if (item[f]) map.set(key(item[f]), item);
    return map;
  };
  const firstNames = new Map();
  for (const e of employees) {
    const first = key(e.full_name).split(' ')[0];
    firstNames.set(first, firstNames.has(first) ? null : e); // null = ambiguous
  }
  return {
    key,
    services: index(services, 'name'),
    products: index(products, 'name', 'sku', 'barcode'),
    staff: index(employees, 'full_name', 'code'),
    firstNames,
  };
}

async function analyseSales(rows, ctx) {
  const decimals = Number(settings.get('financial.currency_decimals') ?? 0);
  const today = todayLocal();
  const lookups = await saleLookups(ctx.branchId);
  const { key } = lookups;

  const checked = rows.map(({ rowNumber, values: v }) => {
    const messages = [];
    const notes = [];
    const display = { date: '', item: text(v.item) || '', customer: text(v.customerName) || text(v.customerPhone) || 'Walk-in', amount: null, receipt: text(v.receipt) || '' };

    const when = dateTime(v.date);
    if (!when) messages.push(v.date === null || v.date === undefined ? 'Date is required.' : `Date "${text(v.date)}" is not a date (use for example 28/09/2026).`);
    else if (when.date > today) messages.push(`Date ${when.date} is in the future.`);
    let time = when?.time || '12:00';
    if (v.time !== null && v.time !== undefined) {
      const t = timeOfDay(v.time);
      if (t) time = t;
      else messages.push(`Time "${text(v.time)}" is not a time (use for example 14:30).`);
    }
    if (when) display.date = when.date;

    // What was sold
    let type = null;
    if (v.type !== null && v.type !== undefined) {
      type = lookupWord(TYPES, v.type);
      if (!type) messages.push(`Type "${v.type}" must be Service or Product.`);
    }
    const itemName = text(v.item);
    let item = null;
    if (!itemName) {
      messages.push('Item is required (the name of the service or product).');
    } else {
      const service = type !== 'product' ? lookups.services.get(key(itemName)) : null;
      const product = type !== 'service' ? lookups.products.get(key(itemName)) : null;
      if (service && product) messages.push(`"${itemName}" is both a service and a product — fill in Type.`);
      else if (service) item = { type: 'service', serviceId: service.id, productId: null, name: service.name, price: Number(service.price), cost: 0 };
      else if (product) item = { type: 'product', serviceId: null, productId: product.id, name: product.name, price: Number(product.selling_price), cost: Number(product.purchase_price) };
      else messages.push(`No ${type || 'service or product'} called "${itemName}". Add it first or correct the name.`);
    }

    const quantity = v.quantity === null || v.quantity === undefined ? 1 : number(v.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) messages.push('Quantity must be a whole number of 1 or more.');

    let amount = null;
    if (v.amount === null || v.amount === undefined) {
      if (item && Number.isInteger(quantity)) {
        amount = round(D(item.price).times(quantity), decimals);
        notes.push('Amount taken from the price list.');
      }
    } else {
      const n = number(v.amount);
      if (Number.isNaN(n) || n < 0) messages.push(`Amount "${text(v.amount)}" is not a valid amount.`);
      else amount = round(D(n), decimals);
    }
    if (amount !== null) display.amount = toNumber(amount);

    // Who did it, who paid, how
    let employeeId = null;
    const staffName = text(v.staff);
    if (staffName) {
      const e = lookups.staff.get(key(staffName)) || lookups.firstNames.get(key(staffName));
      if (e) employeeId = e.id;
      else if (lookups.firstNames.get(key(staffName)) === null) messages.push(`More than one staff member is called "${staffName}" — use the full name.`);
      else messages.push(`No staff member called "${staffName}".`);
    }
    let method = 'cash';
    if (v.paymentMethod !== null && v.paymentMethod !== undefined) {
      method = lookupWord(PAYMENT_METHODS, v.paymentMethod);
      if (!method) messages.push(`Payment method "${v.paymentMethod}" is not recognised (use Cash, Mobile money, Card or Bank transfer).`);
    }
    let phone = null;
    const rawPhone = text(v.customerPhone);
    if (rawPhone) {
      phone = normalizePhone(rawPhone, COUNTRY_CODE);
      if (!/^\+\d{9,15}$/.test(phone)) {
        messages.push(`Customer phone "${rawPhone}" is not a valid phone number.`);
        phone = null;
      }
    }

    const row = {
      rowNumber,
      status: messages.length ? 'error' : 'ready',
      messages: messages.length ? messages : notes,
      display,
      data: {
        date: when?.date, time, receipt: text(v.receipt)?.slice(0, 60) || null, phone, customerName: text(v.customerName)?.slice(0, 120) || null,
        item, quantity, amount, employeeId, method, notes: text(v.notes)?.slice(0, 500) || null,
      },
    };
    return row;
  });

  // Rows with the same receipt number are one sale; they must agree on the sale details.
  const groups = new Map();
  for (const row of checked) {
    const groupKey = row.data.receipt ? `receipt:${row.data.receipt.toLowerCase()}` : `row:${row.rowNumber}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }
  for (const [, group] of groups) {
    const first = group[0];
    for (const row of group.slice(1)) {
      const d = row.data;
      const f = first.data;
      if (row.status !== 'error' && first.status !== 'error'
          && (d.date !== f.date || d.phone !== f.phone || d.method !== f.method || (d.customerName || '') !== (f.customerName || ''))) {
        row.status = 'error';
        row.messages = [`Receipt ${d.receipt} appears on row ${first.rowNumber} with a different date, customer or payment method.`];
      }
    }
    // A sale is imported whole or not at all.
    if (group.some((r) => r.status === 'error')) {
      for (const r of group) {
        if (r.status !== 'error') {
          r.status = 'error';
          r.messages = [`Another row of receipt ${r.data.receipt} has a problem, so this sale cannot be imported yet.`];
        }
      }
    }
  }

  // Already imported (same receipt number from an earlier import).
  const receipts = [...new Set(checked.filter((r) => r.status === 'ready' && r.data.receipt).map((r) => r.data.receipt))];
  if (receipts.length) {
    const done = await db.query(
      'SELECT import_reference, invoice_number FROM sales WHERE branch_id = ? AND is_imported = 1 AND import_reference IN (?)',
      [ctx.branchId, receipts],
    );
    const byRef = new Map(done.map((s) => [s.import_reference.toLowerCase(), s.invoice_number]));
    for (const row of checked) {
      const invoice = row.data.receipt && byRef.get(row.data.receipt.toLowerCase());
      if (row.status === 'ready' && invoice) {
        row.status = 'skip';
        row.messages = [`Receipt ${row.data.receipt} was already imported (${invoice}).`];
      }
    }
  }

  // Customers: match by phone; a new phone with a name becomes a new customer.
  const readyPhones = [...new Set(checked.filter((r) => r.status === 'ready' && r.data.phone).map((r) => r.data.phone))];
  const existing = readyPhones.length
    ? await db.query('SELECT id, phone, full_name FROM customers WHERE phone IN (?) AND deleted_at IS NULL', [readyPhones])
    : [];
  const customers = new Map(existing.map((c) => [c.phone, c]));
  const newCustomers = new Set();
  for (const row of checked.filter((r) => r.status === 'ready' && r.data.phone)) {
    const found = customers.get(row.data.phone);
    if (found) {
      row.data.customerId = found.id;
      row.display.customer = found.full_name;
    } else if (row.data.customerName) {
      newCustomers.add(row.data.phone);
      row.messages = [...row.messages, `${row.data.customerName} will be added as a new customer.`];
    } else {
      row.messages = [...row.messages, 'Phone number is not a registered customer and has no name; recorded as a walk-in.'];
      row.data.phone = null;
    }
  }

  const readyRows = checked.filter((r) => r.status === 'ready');
  const saleKeys = new Set(readyRows.map((r) => (r.data.receipt ? `receipt:${r.data.receipt.toLowerCase()}` : `row:${r.rowNumber}`)));
  return {
    rows: checked,
    summary: {
      sales: saleKeys.size,
      total: toNumber(readyRows.reduce((sum, r) => sum.plus(r.data.amount), D(0))),
      newCustomers: newCustomers.size,
    },
  };
}

async function saveSales(analysis, ctx) {
  const ready = analysis.rows.filter((r) => r.status === 'ready');
  const groups = new Map();
  for (const row of ready) {
    const groupKey = row.data.receipt ? `receipt:${row.data.receipt.toLowerCase()}` : `row:${row.rowNumber}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }

  const result = await db.withTransaction(async (conn) => {
    // New customers first (once per phone number). Marketing consent is
    // unknown for them, so promotions stay off until someone switches them on.
    const createdCustomers = new Map();
    for (const row of ready) {
      const d = row.data;
      if (!d.phone || d.customerId || createdCustomers.has(d.phone)) continue;
      const code = await nextCode(conn, 'customer', 'CUS-', 6);
      const id = await customerModel.insert({
        fullName: d.customerName, phone: d.phone, code, branchId: ctx.branchId, createdBy: ctx.userId, marketingOptIn: false, preferredChannel: 'sms',
      }, conn);
      createdCustomers.set(d.phone, id);
    }

    let total = D(0);
    for (const [, group] of groups) {
      const head = group[0].data;
      const customerId = head.customerId || (head.phone ? createdCustomers.get(head.phone) : null) || null;
      const soldAt = parseDateTime(`${head.date}T${head.time}`);
      const saleTotal = group.reduce((sum, r) => sum.plus(r.data.amount), D(0));
      const cost = group.reduce((sum, r) => sum.plus(D(r.data.item.cost).times(r.data.quantity)), D(0));
      const numbers = await nextDocumentNumbers(conn);
      const notes = [
        `Imported from ${analysis.fileName}${head.receipt ? ` (receipt ${head.receipt})` : ''}`,
        !customerId && head.customerName ? `Customer: ${head.customerName}` : null,
        ...group.map((r) => r.data.notes).filter(Boolean),
      ].filter(Boolean).join(' · ').slice(0, 1000);

      const sale = await db.query(
        `INSERT INTO sales (invoice_number, receipt_number, branch_id, customer_id, cashier_id, subtotal, discount_type, discount_value, discount_amount,
                            loyalty_points_redeemed, loyalty_discount, tax_mode, tax_rate, tax_amount, total, amount_tendered, amount_paid, change_due,
                            balance_due, cost_of_goods, status, payment_status, notes, sold_at, is_imported, import_reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'none', 0, 0, 0, 0, 'none', 0, 0, ?, ?, ?, 0, 0, ?, 'completed', 'paid', ?, ?, 1, ?, ?)`,
        [numbers.invoiceNumber, numbers.receiptNumber, ctx.branchId, customerId, ctx.userId, toNumber(saleTotal), toNumber(saleTotal),
          toNumber(saleTotal), toNumber(saleTotal), toNumber(cost), notes, soldAt, head.receipt, soldAt],
        conn,
      );
      for (const r of group) {
        const d = r.data;
        await db.query(
          `INSERT INTO sale_items (sale_id, item_type, service_id, product_id, employee_id, description, quantity, unit_price, unit_cost,
                                   line_total, net_amount, commission_rate, commission_amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
          [sale.insertId, d.item.type, d.item.serviceId, d.item.productId, d.employeeId, d.item.name, d.quantity,
            toNumber(D(d.amount).dividedBy(d.quantity).toDecimalPlaces(2)), d.item.cost, toNumber(d.amount), toNumber(d.amount)],
          conn,
        );
      }
      await db.query(
        "INSERT INTO payments (sale_id, branch_id, method, type, amount, reference, received_by, paid_at, created_at) VALUES (?, ?, ?, 'payment', ?, ?, ?, ?, ?)",
        [sale.insertId, ctx.branchId, head.method, toNumber(saleTotal), head.receipt, ctx.userId, soldAt, soldAt],
        conn,
      );
      if (customerId) {
        await db.query(
          `UPDATE customers SET total_spent = total_spent + ?, visit_count = visit_count + 1,
                  last_visit_at = GREATEST(COALESCE(last_visit_at, ?), ?) WHERE id = ?`,
          [toNumber(saleTotal), soldAt, soldAt, customerId],
          conn,
        );
      }
      total = total.plus(saleTotal);
    }

    await audit.record(ctx, {
      action: 'sales.imported', entityType: 'sale',
      description: `Imported ${groups.size} past sale${groups.size === 1 ? '' : 's'} (${toNumber(total).toLocaleString('en')}) from ${analysis.fileName}`,
      metadata: { file: analysis.fileName, sales: groups.size, rows: ready.length, total: toNumber(total), newCustomers: createdCustomers.size, skipped: analysis.summary.skipped, errors: analysis.summary.errors },
    }, conn);
    return { imported: groups.size, rows: ready.length, total: toNumber(total), newCustomers: createdCustomers.size };
  });
  return result;
}

// ---- Shared -----------------------------------------------------------------------------

const IMPORTS = {
  customers: { permission: 'customers.import', sheet: 'Customers', title: 'Customers', columns: CUSTOMER_COLUMNS, analyse: analyseCustomers, save: saveCustomers },
  sales: { permission: 'sales.import', sheet: 'Sales', title: 'Sales', columns: SALE_COLUMNS, analyse: analyseSales, save: saveSales },
};

function definition(type) {
  const def = IMPORTS[type];
  if (!def) throw ApiError.notFound('Unknown import type');
  return def;
}

async function analyse(type, file, ctx) {
  const def = definition(type);
  if (!file) throw ApiError.validation([{ field: 'file', message: 'Choose an Excel (.xlsx) or CSV file' }]);
  let parsed;
  try {
    parsed = await parseSpreadsheet(file.buffer, file.originalname, def.columns, { sheetName: def.sheet });
  } catch (error) {
    throw ApiError.validation([{ field: 'file', message: error.message }]);
  }
  const missing = def.columns.filter((c) => c.required && !parsed.mapped.some((m) => m.key === c.key)).map((c) => c.label);
  if (missing.length) {
    throw ApiError.validation([{
      field: 'file',
      message: `The file needs a column called ${missing.map((m) => `"${m}"`).join(' and ')}. Download the template to see the expected columns.`,
    }]);
  }
  if (!parsed.rows.length) throw ApiError.validation([{ field: 'file', message: 'The file has column headings but no rows to import.' }]);

  const result = await def.analyse(parsed.rows, ctx);
  const count = (status) => result.rows.filter((r) => r.status === status).length;
  return {
    type,
    fileName: String(file.originalname || 'upload').slice(0, 120),
    columns: {
      mapped: parsed.mapped.map((m) => ({ ...m, label: label(def.columns, m.key) })),
      ignored: parsed.unknown,
    },
    summary: { rows: result.rows.length, ready: count('ready'), skipped: count('skip'), errors: count('error'), ...result.summary },
    rows: result.rows.map(({ data, ...row }) => row),
    _rows: result.rows,
  };
}

async function preview(type, file, ctx) {
  const { _rows, ...analysis } = await analyse(type, file, ctx);
  return analysis;
}

async function run(type, file, { skipInvalid = false } = {}, ctx) {
  const def = definition(type);
  const { _rows, ...analysis } = await analyse(type, file, ctx);
  if (analysis.summary.errors && !skipInvalid) {
    throw ApiError.validation([{ field: 'file', message: `${analysis.summary.errors} row(s) have problems. Fix them, or choose to skip them, and import again.` }]);
  }
  if (!analysis.summary.ready) throw ApiError.badRequest('There is nothing new to import in this file.');
  const saved = await def.save({ ...analysis, rows: _rows }, ctx);
  return { ...saved, summary: analysis.summary, fileName: analysis.fileName };
}

// ---- Templates --------------------------------------------------------------------------

const BRAND = 'FFE3166A';

function styleHeader(ws, columns) {
  ws.columns = columns.map((c) => ({ header: c.required ? `${c.label}*` : c.label, key: c.key, width: c.width || 16 }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function listValidation(ws, column, count, formula) {
  const letter = ws.getColumn(column).letter;
  ws.dataValidations.add(`${letter}2:${letter}${count + 1}`, { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [formula] });
}

function guideSheet(wb, lines, example) {
  const guide = wb.addWorksheet('How to fill');
  guide.getColumn(1).width = 110;
  guide.addRow([`${config.appName} — import template`]).font = { bold: true, color: { argb: BRAND }, size: 12 };
  guide.addRow([]);
  for (const line of lines) guide.addRow([line]).alignment = { wrapText: true };
  if (example) {
    guide.addRow([]);
    guide.addRow(['Example rows (do not paste these into the first sheet unless they are real):']).font = { bold: true };
    const table = wb.addWorksheet('Example');
    table.addRows(example);
    table.getRow(1).font = { bold: true };
    table.columns.forEach((c) => { c.width = 18; });
  }
}

async function template(type, ctx) {
  const def = definition(type);
  const wb = new ExcelJS.Workbook();
  wb.creator = config.appName;
  const ws = wb.addWorksheet(def.sheet);
  styleHeader(ws, def.columns);
  const rows = 2000;

  if (type === 'customers') {
    listValidation(ws, 'gender', rows, '"Female,Male,Other"');
    listValidation(ws, 'marketingOptIn', rows, '"Yes,No"');
    listValidation(ws, 'preferredChannel', rows, '"SMS,WhatsApp,Email,None"');
    ws.getColumn('dateOfBirth').numFmt = 'dd/mm/yyyy';
    ws.getColumn('phone').numFmt = '@';
    guideSheet(wb, [
      'Fill one customer per row on the "Customers" sheet, starting on row 2. Columns marked * are required.',
      'Phone: any common format works — 0712 345 678, 712345678 or +255712345678. Numbers already registered are skipped, never duplicated.',
      'Birthday: an Excel date or text written day first, e.g. 25/12/1990.',
      'Gender: Female, Male or Other. Promotions: Yes or No (default Yes). Contact via: SMS, WhatsApp, Email or None (default SMS).',
      'You can also upload your own sheet or a CSV file: the column names only need to be similar (for example "Name" and "Phone number").',
    ], [
      ['Full name', 'Phone', 'Email', 'Gender', 'Birthday', 'Address', 'Notes', 'Promotions', 'Contact via'],
      ['Asha Mrisho', '0712345678', 'asha@example.com', 'Female', '14/02/1994', 'Sinza, Dar es Salaam', 'Prefers Saturday mornings', 'Yes', 'WhatsApp'],
      ['Juma Ally', '0754 000 111', '', 'Male', '', 'Mbezi', '', 'No', 'SMS'],
    ]);
  } else {
    const lookups = await Promise.all([
      db.query('SELECT name, price FROM services WHERE is_active = 1 ORDER BY name'),
      db.query("SELECT name, sku, selling_price FROM products WHERE branch_id = ? AND status = 'active' ORDER BY name", [ctx.branchId]),
      db.query("SELECT full_name, code FROM employees WHERE branch_id = ? AND status IN ('active', 'on_leave') ORDER BY full_name", [ctx.branchId]),
    ]);
    const [services, products, staff] = lookups;
    const priceList = wb.addWorksheet('Price list');
    priceList.columns = [{ header: 'Item', width: 30 }, { header: 'Type', width: 10 }, { header: 'Price', width: 12 }, { header: 'SKU', width: 14 }];
    priceList.getRow(1).font = { bold: true };
    for (const s of services) priceList.addRow([s.name, 'Service', Number(s.price), '']);
    for (const p of products) priceList.addRow([p.name, 'Product', Number(p.selling_price), p.sku || '']);
    const staffSheet = wb.addWorksheet('Staff');
    staffSheet.columns = [{ header: 'Staff', width: 28 }, { header: 'Code', width: 12 }];
    staffSheet.getRow(1).font = { bold: true };
    for (const e of staff) staffSheet.addRow([e.full_name, e.code]);

    const items = services.length + products.length;
    if (items) listValidation(ws, 'item', rows, `'Price list'!$A$2:$A$${items + 1}`);
    if (staff.length) listValidation(ws, 'staff', rows, `Staff!$A$2:$A$${staff.length + 1}`);
    listValidation(ws, 'type', rows, '"Service,Product"');
    listValidation(ws, 'paymentMethod', rows, '"Cash,Mobile money,Card,Bank transfer"');
    ws.getColumn('date').numFmt = 'dd/mm/yyyy';
    ws.getColumn('customerPhone').numFmt = '@';
    ws.getColumn('amount').numFmt = '#,##0';
    guideSheet(wb, [
      'One row per service or product sold, on the "Sales" sheet, starting on row 2. Columns marked * are required.',
      'Rows with the same Receipt no are ONE sale (for example a haircut and a product bought together). Give every sale a receipt number: importing the same file again then skips sales that are already in.',
      'Date: an Excel date or text written day first, e.g. 28/09/2026. Time is optional (e.g. 14:30); without it the sale is recorded at 12:00.',
      'Item: the exact name of a service or product from the "Price list" sheet (the cell has a drop-down). Type is only needed if a service and a product share a name.',
      'Amount: what the customer paid for that row (quantity × price). Leave it empty to use today\'s price list.',
      'Customer phone / name: a registered phone links the sale to that customer. A new phone with a name adds the customer. Leave both empty for a walk-in.',
      'Payment method: Cash, Mobile money (M-Pesa, Tigo Pesa, Airtel Money…), Card or Bank transfer. Default is Cash.',
      'Imported sales appear in reports and customer history. They do not change stock, earn loyalty points or create staff commission, because that already happened outside the system.',
    ], [
      ['Date', 'Time', 'Receipt no', 'Customer phone', 'Customer name', 'Type', 'Item', 'Staff', 'Quantity', 'Amount', 'Payment method', 'Notes'],
      ['02/09/2026', '10:30', 'R-1001', '0712345678', 'Asha Mrisho', 'Service', services[0]?.name || 'Haircut', staff[0]?.full_name || '', 1, Number(services[0]?.price || 15000), 'Mobile money', ''],
      ['02/09/2026', '10:30', 'R-1001', '0712345678', 'Asha Mrisho', 'Product', products[0]?.name || 'Shampoo', '', 1, Number(products[0]?.selling_price || 9000), 'Mobile money', ''],
      ['02/09/2026', '15:00', 'R-1002', '', '', 'Service', services[1]?.name || 'Manicure', staff[1]?.full_name || '', 1, '', 'Cash', 'Walk-in'],
    ]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { IMPORTS, preview, run, template, definition };
