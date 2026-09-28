'use strict';

/**
 * Demo activity for ZOLA STYLISH MANAGEMENT SYSTEM (SEED_DEMO_DATA=true only).
 *
 * Builds about four months of realistic salon history — appointments, sales,
 * refunds, stock purchases, salon-use stock, expenses, payroll, attendance and
 * leave — and a week of upcoming bookings. Sales, refunds, purchases, expenses
 * and payroll go through the real business services, so every figure is
 * consistent: stock ledger, commissions, loyalty points and tiers, customer
 * statistics and document numbers all match what the live system would record.
 *
 * Everything created here is flagged is_demo = 1 (or belongs to demo records)
 * and is removed by `npm run demo:clear`. A seeded random generator keeps the
 * shape of the data identical between runs; dates are relative to today.
 */
const crypto = require('crypto');
const { DateTime } = require('luxon');
const db = require('../../src/config/database');
const settings = require('../../src/services/settingsService');
const salesService = require('../../src/services/salesService');
const supplierService = require('../../src/services/supplierService');
const expenseService = require('../../src/services/expenseService');
const payrollService = require('../../src/services/payrollService');
const inventoryService = require('../../src/services/inventoryService');
const { nextCode } = require('../../src/utils/sequence');
const { timezone } = require('../../src/utils/time');

const MONTHS_OF_HISTORY = 3; // full months before the current month
const UPCOMING_DAYS = 8;
const EXTRA_CUSTOMERS = 110;

// ---- Deterministic randomness ---------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260101);
const chance = (p) => rand() < p;
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
function weighted(items, weightOf) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let r = rand() * total;
  for (const item of items) {
    r -= weightOf(item);
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}
const roundTo = (value, step) => Math.round(value / step) * step;

// ---- Reference lists --------------------------------------------------------------------------

const FEMALE_NAMES = ['Aisha', 'Anna', 'Asha', 'Beatrice', 'Bahati', 'Christina', 'Doris', 'Esther', 'Faraja', 'Flora', 'Furaha', 'Glory', 'Happiness', 'Irene', 'Jacqueline', 'Janeth', 'Judith', 'Lilian', 'Lucy', 'Mwanaisha', 'Nasra', 'Pendo', 'Prisca', 'Salma', 'Sharifa', 'Tatu', 'Upendo', 'Veronica', 'Witness', 'Zainabu', 'Mercy', 'Elizabeth', 'Hadija', 'Rukia', 'Subira', 'Stella', 'Consolata', 'Editha', 'Gladness', 'Loveness'];
const MALE_NAMES = ['Abdul', 'Collins', 'Daudi', 'Elia', 'Frank', 'Godfrey', 'Hamisi', 'Ibrahim', 'Juma', 'Kelvin', 'Mussa', 'Nassoro', 'Omary', 'Rajabu', 'Said', 'Tumaini', 'Yusuf', 'Brian', 'Innocent', 'Erick'];
const SURNAMES = ['Mwakyusa', 'Kimaro', 'Massawe', 'Mushi', 'Swai', 'Lyimo', 'Temba', 'Mollel', 'Minja', 'Mrema', 'Shirima', 'Kweka', 'Lema', 'Mfinanga', 'Mbwambo', 'Kisanga', 'Chande', 'Magesa', 'Mwinyi', 'Salim', 'Hamad', 'Makame', 'Ngowi', 'Urassa', 'Kavishe', 'Kapinga', 'Haule', 'Komba', 'Mapunda', 'Nyoni', 'Sanga', 'Kiwelu', 'Mtui', 'Laizer', 'Msuya', 'Njau'];
const AREAS = ['Masaki', 'Oysterbay', 'Mikocheni', 'Msasani', 'Sinza', 'Kinondoni', 'Mbezi Beach', 'Tegeta', 'Kijitonyama', 'Upanga', 'Kariakoo', 'Ilala', 'Temeke', 'Kigamboni', 'Tabata', 'Ubungo', 'Kimara', 'Mwenge', 'Goba', 'Bahari Beach'];
const CANCEL_REASONS = ['Customer travelling', 'Customer unwell', 'Rescheduled by phone', 'Clashed with work', 'Family emergency'];
const REFUND_REASONS = ['Customer unhappy with colour result', 'Product returned unopened', 'Service charged twice by mistake'];
const PAYMENT_METHODS = [
  { value: 'cash', weight: 44 },
  { value: 'mobile_money', weight: 42 },
  { value: 'card', weight: 10 },
  { value: 'bank_transfer', weight: 4 },
];

// ---- Helpers ----------------------------------------------------------------------------------

const zone = () => timezone();
const toUtc = (dt) => dt.toUTC().toJSDate();
const hhmm = (date, time) => DateTime.fromISO(`${date.toISODate()}T${String(time).slice(0, 5)}`, { zone: zone() });

function overlaps(list, start, end) {
  return list.some((slot) => start < slot.end && end > slot.start);
}

function mobileReference() {
  return `${pick(['MP', 'TP', 'AM', 'HP'])}${int(10, 99)}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function cashTendered(total) {
  if (chance(0.45)) return total;
  const step = total > 50000 ? 10000 : 5000;
  return Math.ceil(total / step) * step;
}

class Timeline {
  constructor() {
    this.stats = { customers: 0, appointments: 0, sales: 0, refunds: 0, purchases: 0, expenses: 0, salaries: 0, attendance: 0 };
    this.customerSlots = new Map(); // `${customerId}|${date}` -> [{start, end}]
    this.pendingSupplierPayments = []; // { date, purchaseId, amount }
    this.pendingRefunds = []; // { date, saleId }
  }
}

// ---- Loading ----------------------------------------------------------------------------------

async function loadReference(branchId) {
  const employees = await db.query(
    "SELECT id, full_name, job_title, is_bookable, status FROM employees WHERE branch_id = ? AND is_demo = 1 AND status = 'active' ORDER BY id",
    [branchId],
  );
  const schedules = await db.query('SELECT employee_id, day_of_week, start_time, end_time, is_working FROM employee_schedules');
  const links = await db.query('SELECT employee_id, service_id FROM employee_services');
  const services = await db.query(
    `SELECT s.id, s.name, s.price, s.duration_minutes, c.name AS category
     FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
     WHERE s.is_active = 1 AND s.is_demo = 1`,
  );
  for (const e of employees) {
    e.schedule = new Map(schedules.filter((s) => s.employee_id === e.id).map((s) => [s.day_of_week, s]));
    e.services = links.filter((l) => l.employee_id === e.id).map((l) => services.find((s) => s.id === l.service_id)).filter(Boolean);
  }
  const products = await db.query(
    "SELECT id, name, is_retail, quantity, min_stock, max_stock, supplier_id, purchase_price, selling_price, unit FROM products WHERE branch_id = ? AND is_demo = 1 AND status = 'active'",
    [branchId],
  );
  const suppliers = await db.query('SELECT id, name FROM suppliers WHERE is_demo = 1 AND is_active = 1');
  const categories = Object.fromEntries((await db.query('SELECT id, slug FROM expense_categories')).map((c) => [c.slug, c.id]));
  return { employees, services, products, suppliers, categories };
}

async function createCustomers(branchId, adminId, periodStart, today, timeline) {
  const existing = await db.query('SELECT id, full_name, gender, created_at FROM customers WHERE is_demo = 1 AND deleted_at IS NULL');
  const customers = existing.map((c, index) => ({
    id: c.id,
    gender: c.gender,
    joined: DateTime.fromJSDate(c.created_at).setZone(zone()).startOf('day'),
    // The hand-written demo customers are the salon's regulars.
    weight: index < 12 ? 2.4 - index * 0.1 : 1,
  }));
  const periodDays = Math.max(1, Math.round(today.diff(periodStart, 'days').days));

  await db.withTransaction(async (conn) => {
    for (let i = 0; i < EXTRA_CUSTOMERS; i += 1) {
      const female = chance(0.74);
      const first = female ? pick(FEMALE_NAMES) : pick(MALE_NAMES);
      const last = pick(SURNAMES);
      const hasEmail = chance(0.35);
      const joined = chance(0.55)
        ? periodStart.minus({ days: int(20, 420) })
        : periodStart.plus({ days: int(0, periodDays) });
      const birthday = chance(0.06)
        ? today.plus({ days: int(0, 6) }).set({ year: int(1978, 2003) }) // a few birthdays this week
        : DateTime.fromObject({ year: int(1975, 2005), month: int(1, 12), day: int(1, 28) });
      const channel = hasEmail && chance(0.2) ? 'email' : weighted([{ v: 'whatsapp', w: 48 }, { v: 'sms', w: 46 }, { v: 'none', w: 6 }], (x) => x.w).v;
      const code = await nextCode(conn, 'customer', 'CUS-', 6);
      const result = await db.query(
        `INSERT INTO customers (code, branch_id, full_name, phone, email, gender, date_of_birth, address, marketing_opt_in, preferred_channel,
                                is_demo, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          code, branchId, `${first} ${last}`, `+255754${String(300001 + i)}`,
          hasEmail ? `${first}.${last}${i}@example.com`.toLowerCase() : null,
          female ? 'female' : 'male', birthday.toISODate(), `${pick(AREAS)}, Dar es Salaam`, chance(0.85) ? 1 : 0, channel,
          adminId, toUtc(joined.set({ hour: int(9, 18), minute: int(0, 59) })),
        ],
        conn,
      );
      customers.push({ id: result.insertId, gender: female ? 'female' : 'male', joined, weight: 0.12 + 2.2 * rand() ** 2.4 });
      timeline.stats.customers += 1;
    }
  });
  return customers;
}

// ---- Staff: leave & attendance ------------------------------------------------------------------

async function createLeave(employees, adminId, periodStart, today) {
  const byTitle = (pattern) => employees.find((e) => pattern.test(e.job_title || '')) || pick(employees);
  const leave = [
    { employee: byTitle(/nail/i), type: 'annual', start: periodStart.plus({ days: 38 }), days: 4, status: 'approved', reason: 'Family visit in Moshi' },
    { employee: byTitle(/massage/i), type: 'sick', start: periodStart.plus({ days: 71 }), days: 2, status: 'approved', reason: 'Flu (doctor’s note provided)' },
    { employee: byTitle(/braid/i), type: 'annual', start: today.plus({ days: 18 }), days: 5, status: 'pending', reason: 'Wedding in Arusha' },
  ];
  const records = [];
  for (const l of leave) {
    const end = l.start.plus({ days: l.days - 1 });
    await db.query(
      `INSERT INTO leave_records (employee_id, leave_type, start_date, end_date, reason, status, reviewed_by, reviewed_at, created_by, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        l.employee.id, l.type, l.start.toISODate(), end.toISODate(), l.reason, l.status,
        l.status === 'approved' ? adminId : null, l.status === 'approved' ? toUtc(l.start.minus({ days: 5 }).set({ hour: 10 })) : null,
        adminId, toUtc(l.start.minus({ days: 8 }).set({ hour: 9 })),
      ],
    );
    if (l.status === 'approved') records.push({ employeeId: l.employee.id, from: l.start.toISODate(), to: end.toISODate() });
  }
  return (employeeId, isoDate) => records.some((r) => r.employeeId === employeeId && isoDate >= r.from && isoDate <= r.to);
}

/** Record attendance for one day; returns the employees who actually worked (with their hours). */
async function recordAttendance(conn, employees, date, now, onLeave, adminId, branchId, timeline) {
  const working = [];
  const isToday = date.hasSame(now, 'day');
  for (const e of employees) {
    const day = e.schedule.get(date.weekday % 7);
    if (!day || !day.is_working) continue;
    const windowStart = hhmm(date, day.start_time);
    const windowEnd = hhmm(date, day.end_time);
    if (isToday && now < windowStart) {
      working.push({ employee: e, start: windowStart, end: windowEnd });
      continue; // not in yet
    }
    let status;
    let clockIn = null;
    let clockOut = null;
    if (onLeave(e.id, date.toISODate())) {
      status = 'on_leave';
    } else if (chance(0.025)) {
      status = 'absent';
    } else {
      const late = chance(0.08);
      status = late ? 'late' : 'present';
      clockIn = windowStart.plus({ minutes: late ? int(18, 45) : -int(0, 15) });
      clockOut = !isToday || now > windowEnd.plus({ minutes: 30 }) ? windowEnd.plus({ minutes: int(0, 25) }) : null;
      working.push({ employee: e, start: late ? clockIn.plus({ minutes: 15 - (clockIn.minute % 15) }) : windowStart, end: windowEnd });
    }
    await db.query(
      `INSERT INTO attendance (employee_id, branch_id, work_date, clock_in, clock_out, status, notes, recorded_by, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        e.id, branchId, date.toISODate(), clockIn ? toUtc(clockIn) : null, clockOut ? toUtc(clockOut) : null, status,
        status === 'absent' ? 'Called in — did not come' : null, status === 'absent' || status === 'on_leave' ? adminId : null,
        toUtc(clockIn || windowStart),
      ],
      conn,
    );
    timeline.stats.attendance += 1;
  }
  return working;
}

// ---- Appointments -----------------------------------------------------------------------------

function serviceWeight(service) {
  const base = 1 / Math.sqrt(Math.max(service.price, 5000) / 10000);
  return /bridal/i.test(service.name) ? base * 0.15 : base;
}

function pickCustomer(customers, service, date, start, end, timeline) {
  const menOnly = /barber|haircut/i.test(`${service.category} ${service.name}`) && !/kids/i.test(service.name);
  const unisex = /massage|spa|facial|kids/i.test(`${service.category} ${service.name}`);
  const key = (c) => `${c.id}|${date.toISODate()}`;
  const eligible = customers.filter((c) => {
    if (c.joined > date) return false;
    if (!unisex && (menOnly ? c.gender !== 'male' : c.gender === 'male')) return false;
    return !overlaps(timeline.customerSlots.get(key(c)) || [], start, end);
  });
  if (!eligible.length) return null;
  const customer = weighted(eligible, (c) => c.weight);
  const slots = timeline.customerSlots.get(key(customer)) || [];
  slots.push({ start, end });
  timeline.customerSlots.set(key(customer), slots);
  return customer;
}

/** Lay out one stylist's bookings for a day inside their working window. */
function planDay(shift, date, customers, utilization, timeline) {
  const bookings = [];
  let cursor = shift.start.plus({ minutes: 15 * int(0, 3) });
  while (cursor < shift.end) {
    if (!chance(utilization)) {
      cursor = cursor.plus({ minutes: 15 * int(3, 6) });
      continue;
    }
    const options = shift.employee.services.filter((s) => cursor.plus({ minutes: s.duration_minutes }) <= shift.end);
    if (!options.length) break;
    const first = weighted(options, serviceWeight);
    const chosen = [first];
    const extra = options.filter((s) => s.id !== first.id && cursor.plus({ minutes: first.duration_minutes + s.duration_minutes }) <= shift.end);
    if (extra.length && chance(0.14)) chosen.push(weighted(extra, serviceWeight));
    const duration = chosen.reduce((sum, s) => sum + s.duration_minutes, 0);
    const end = cursor.plus({ minutes: duration });
    const customer = pickCustomer(customers, first, date, cursor, end, timeline);
    if (customer) bookings.push({ employee: shift.employee, customer, services: chosen, start: cursor, end, duration });
    cursor = end.plus({ minutes: 15 * int(0, 2) });
  }
  return bookings;
}

async function insertAppointment(conn, booking, { status, adminId, branchId, now }) {
  const code = await nextCode(conn, 'appointment', 'APT-', 6);
  const source = weighted([{ v: 'phone', w: 34 }, { v: 'whatsapp', w: 30 }, { v: 'walk_in', w: 20 }, { v: 'online', w: 11 }, { v: 'other', w: 5 }], (x) => x.w).v;
  let createdAt = source === 'walk_in' ? booking.start.minus({ minutes: int(5, 20) }) : booking.start.minus({ days: int(1, 9), hours: int(0, 6) });
  if (createdAt > now) createdAt = now.minus({ minutes: 30 });
  const total = booking.services.reduce((sum, s) => sum + Number(s.price), 0);
  const checkedIn = ['in_progress', 'completed'].includes(status) ? booking.start.minus({ minutes: int(2, 12) }) : null;
  const cancelledAt = status === 'cancelled' ? booking.start.minus({ hours: int(3, 30) }) : status === 'no_show' ? booking.start.plus({ minutes: 45 }) : null;
  const result = await db.query(
    `INSERT INTO appointments (code, branch_id, customer_id, employee_id, start_time, end_time, status, source, total_price, total_duration,
                               qr_token, checked_in_at, checked_in_by, confirmed_at, started_at, cancelled_at, cancellation_reason, cancelled_by,
                               reminder_sent_at, created_by, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      code, branchId, booking.customer.id, booking.employee.id, toUtc(booking.start), toUtc(booking.end), status, source, total, booking.duration,
      crypto.randomBytes(16).toString('hex'), checkedIn ? toUtc(checkedIn) : null, checkedIn ? adminId : null,
      status === 'pending' ? null : toUtc(createdAt.plus({ minutes: 20 })), checkedIn ? toUtc(booking.start) : null,
      cancelledAt && cancelledAt < now ? toUtc(cancelledAt) : null, status === 'cancelled' ? pick(CANCEL_REASONS) : status === 'no_show' ? 'Did not arrive' : null,
      cancelledAt ? adminId : null, booking.start.minus({ hours: 24 }) < now && source !== 'walk_in' ? toUtc(booking.start.minus({ hours: 24 })) : null,
      adminId, toUtc(createdAt),
    ],
    conn,
  );
  await db.query(
    'INSERT INTO appointment_services (appointment_id, service_id, service_name, price, duration_minutes, sort_order) VALUES ?',
    [booking.services.map((s, i) => [result.insertId, s.id, s.name, s.price, s.duration_minutes, i])],
    conn,
  );
  return result.insertId;
}

// ---- Sales ------------------------------------------------------------------------------------

function paymentsFor(total) {
  if (chance(0.05) && total >= 20000) {
    const mobile = roundTo(total * 0.5, 1000);
    return [
      { method: 'mobile_money', amount: mobile, reference: mobileReference() },
      { method: 'cash', amount: cashTendered(total - mobile) },
    ];
  }
  const method = weighted(PAYMENT_METHODS, (m) => m.weight).value;
  if (method === 'cash') return [{ method, amount: cashTendered(total) }];
  return [{ method, amount: total, reference: method === 'mobile_money' ? mobileReference() : method === 'card' ? `POS-${int(100000, 999999)}` : undefined }];
}

function addRetail(items, products, maxLines = 1) {
  const retail = products.filter((p) => p.is_retail && p.quantity > 2);
  for (let i = 0; i < maxLines && retail.length; i += 1) {
    const product = weighted(retail, (p) => 1 / Math.sqrt(Math.max(Number(p.selling_price), 3000) / 5000));
    if (items.some((it) => it.productId === product.id)) continue;
    const quantity = product.selling_price < 10000 && chance(0.3) ? 2 : 1;
    items.push({ type: 'product', productId: product.id, quantity });
  }
}

async function sell({ items, customerId, appointmentId, soldAt, ctx, products, recent, timeline }) {
  const data = { customerId: customerId || null, appointmentId: appointmentId || null, items, discount: { type: 'none', value: 0 }, notes: null };
  if (customerId && chance(0.06)) data.discount = { type: 'percentage', value: 10 };
  else if (customerId && chance(0.02)) data.discount = { type: 'amount', value: 5000 };

  let quote = await salesService.quote(data, ctx);
  if (customerId && quote.maxRedeemable > 0 && chance(0.3)) {
    data.loyaltyPoints = quote.maxRedeemable;
    quote = await salesService.quote(data, ctx);
  }
  const total = quote.total;
  if (customerId && recent && settings.get('financial.allow_partial_payments') && chance(0.05)) {
    const part = roundTo(total * 0.5, 1000);
    data.payments = [{ method: 'cash', amount: part }]; // balance left on account
  } else {
    data.payments = paymentsFor(total);
  }
  const sale = await salesService.createSale(data, ctx, { soldAt: toUtc(soldAt), silent: true, demo: true });
  for (const item of items.filter((i) => i.type === 'product')) {
    const product = products.find((p) => p.id === item.productId);
    product.quantity -= item.quantity;
  }
  timeline.stats.sales += 1;
  return sale;
}

// ---- Stock ------------------------------------------------------------------------------------

async function restock(date, at, products, suppliers, ctx, timeline) {
  const low = products.filter((p) => p.quantity <= p.min_stock);
  if (!low.length) return;
  const bySupplier = new Map();
  for (const p of low) {
    const supplierId = p.supplier_id || pick(suppliers).id;
    if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, []);
    bySupplier.get(supplierId).push(p);
  }
  for (const [supplierId, list] of bySupplier) {
    const items = list.map((p) => ({
      productId: p.id,
      quantity: Math.max(p.min_stock * 2, (p.max_stock || p.min_stock * 4) - p.quantity),
      unitCost: roundTo(Number(p.purchase_price) * (0.97 + rand() * 0.08), 100),
    }));
    const total = items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
    const payNow = chance(0.7) ? total : roundTo(total * 0.5, 1000);
    const purchase = await supplierService.createPurchase(
      {
        supplierId,
        purchaseDate: date.toISODate(),
        supplierInvoiceNo: `INV-${int(1000, 9999)}`,
        items,
        receiveNow: true,
        initialPayment: { amount: payNow, paymentMethod: chance(0.6) ? 'bank_transfer' : 'mobile_money', reference: `PAY-${int(10000, 99999)}` },
        notes: 'Restock',
      },
      ctx,
      { at: toUtc(at), demo: true },
    );
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      product.quantity += item.quantity;
      product.purchase_price = item.unitCost;
    }
    if (payNow < total) timeline.pendingSupplierPayments.push({ date: date.plus({ days: int(7, 14) }).toISODate(), purchaseId: purchase.id, amount: total - payNow });
    timeline.stats.purchases += 1;
  }
}

async function useSalonStock(at, products, ctx) {
  const supplies = products.filter((p) => !p.is_retail && p.quantity > 0);
  if (!supplies.length || !chance(0.3)) return;
  const product = pick(supplies);
  await db.withTransaction((conn) =>
    inventoryService.changeStock(conn, {
      productId: product.id, branchId: ctx.branchId, change: -1, type: 'internal_use', reason: 'Used during services',
      userId: ctx.userId, at: toUtc(at),
    }),
  );
  product.quantity -= 1;
}

// ---- Money out --------------------------------------------------------------------------------

async function monthlyExpenses(monthStart, today, categories, ctx, timeline) {
  const month = monthStart.toFormat('LLLL yyyy');
  const plan = [
    { day: 1, slug: 'rent', amount: 1500000, description: `Shop rent — ${month}`, vendor: 'Mlimani Properties Ltd', method: 'bank_transfer' },
    { day: 3, slug: 'other', amount: 120000, description: `Fibre internet — ${month}`, vendor: 'Vodacom Business', method: 'mobile_money' },
    { day: 6, slug: 'electricity', amount: int(17, 26) * 10000, description: 'LUKU electricity tokens', vendor: 'TANESCO', method: 'mobile_money' },
    { day: 8, slug: 'supplies', amount: int(30, 90) * 1000, description: 'Cleaning supplies & toiletries', vendor: 'Shoppers Supermarket', method: 'cash' },
    { day: 10, slug: 'water', amount: int(35, 60) * 1000, description: `Water bill — ${month}`, vendor: 'DAWASA', method: 'mobile_money' },
    { day: 14, slug: 'marketing', amount: int(5, 15) * 10000, description: 'Instagram & Facebook ads', vendor: 'Meta Platforms', method: 'card' },
    { day: 20, slug: 'transport', amount: int(20, 50) * 1000, description: 'Deliveries & late-shift staff transport', vendor: 'Bolt / bodaboda', method: 'cash' },
    { day: 22, slug: 'supplies', amount: int(25, 70) * 1000, description: 'Towels, capes & disposables', vendor: 'Kariakoo Market', method: 'cash' },
  ];
  if (chance(0.5)) plan.push({ day: int(11, 25), slug: 'maintenance', amount: int(5, 25) * 10000, description: pick(['Hood dryer repair', 'Styling chair hydraulic repair', 'AC servicing', 'Plumbing — wash basin']), vendor: 'Fundi Services', method: 'cash' });

  for (const item of plan) {
    const date = monthStart.set({ day: item.day });
    if (date > today || !categories[item.slug]) continue;
    const expense = await expenseService.create(
      { categoryId: categories[item.slug], expenseDate: date.toISODate(), amount: item.amount, description: item.description, paymentMethod: item.method, vendor: item.vendor, reference: `RCPT-${int(1000, 9999)}` },
      ctx,
    );
    await db.query('UPDATE expenses SET is_demo = 1, created_at = ? WHERE id = ?', [toUtc(date.set({ hour: 11, minute: int(0, 59) })), expense.id]);
    timeline.stats.expenses += 1;
  }
}

async function runPayroll(monthStart, ctx, timeline) {
  const periodStart = monthStart.toISODate();
  const periodEnd = monthStart.endOf('month').toISODate();
  const paidDate = monthStart.endOf('month').startOf('day');
  await payrollService.generate({ periodStart, periodEnd }, ctx);
  const records = await db.query("SELECT id FROM salary_records WHERE branch_id = ? AND period_start = ? AND status = 'pending'", [ctx.branchId, periodStart]);
  for (const record of records) {
    await payrollService.pay(record.id, { paymentMethod: 'bank_transfer', paidDate: paidDate.toISODate() }, ctx);
    const paidAt = toUtc(paidDate.set({ hour: 17, minute: int(0, 40) }));
    await db.query('UPDATE salary_records SET is_demo = 1, paid_at = ?, created_at = ? WHERE id = ?', [paidAt, toUtc(paidDate.set({ hour: 9 })), record.id]);
    await db.query('UPDATE expenses e JOIN salary_records r ON r.expense_id = e.id SET e.is_demo = 1, e.created_at = ? WHERE r.id = ?', [paidAt, record.id]);
    timeline.stats.salaries += 1;
  }
}

// ---- Main -------------------------------------------------------------------------------------

module.exports = async function generateActivity() {
  await settings.load();
  const already = await db.queryOne('SELECT COUNT(*) AS total FROM sales WHERE is_demo = 1');
  if (Number(already.total) > 0) {
    console.log('• Demo activity already generated — skipped.');
    return;
  }
  console.log('• Generating demo activity (appointments, sales, stock, expenses, payroll)...');
  const began = Date.now();

  const branch = await db.queryOne('SELECT id FROM branches WHERE is_default = 1 ORDER BY id LIMIT 1');
  const admin = await db.queryOne("SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id WHERE r.slug = 'super_admin' ORDER BY u.id LIMIT 1");
  const frontDesk = (await db.queryOne("SELECT id, full_name FROM users WHERE email = 'receptionist.demo@zolastylish.local'")) || admin;
  const contextFor = (user) => ({
    userId: user.id,
    branchId: branch.id,
    ip: '127.0.0.1',
    userAgent: 'demo-data-generator',
    user: { id: user.id, fullName: user.full_name, isSuperAdmin: true, permissions: new Set() },
  });
  const adminCtx = contextFor(admin);
  const deskCtx = contextFor(frontDesk);
  const cashierCtx = () => (chance(0.8) ? deskCtx : adminCtx);
  const firstLog = (await db.queryOne('SELECT COALESCE(MAX(id), 0) AS id FROM activity_logs')).id;
  const firstNotification = (await db.queryOne('SELECT COALESCE(MAX(id), 0) AS id FROM notifications')).id;

  const now = DateTime.now().setZone(zone());
  const today = now.startOf('day');
  const periodStart = today.minus({ months: MONTHS_OF_HISTORY }).startOf('month');
  const timeline = new Timeline();

  const ref = await loadReference(branch.id);
  const bookable = ref.employees.filter((e) => e.is_bookable && e.services.length);
  const customers = await createCustomers(branch.id, admin.id, periodStart, today, timeline);
  const onLeave = await createLeave(ref.employees, admin.id, periodStart, today);

  // Opening stock was counted before the first demo sale.
  await db.query(
    "UPDATE inventory_transactions t JOIN products p ON p.id = t.product_id SET t.created_at = ? WHERE t.type = 'opening' AND p.is_demo = 1",
    [toUtc(periodStart.minus({ days: 1 }).set({ hour: 9 }))],
  );

  let currentMonth = null;
  for (let date = periodStart; date <= today; date = date.plus({ days: 1 })) {
    // Month boundaries: pay last month's salaries, then book this month's fixed costs.
    if (!currentMonth || !date.hasSame(currentMonth, 'month')) {
      if (currentMonth) await runPayroll(currentMonth, adminCtx, timeline);
      currentMonth = date.startOf('month');
      await monthlyExpenses(currentMonth, today, ref.categories, adminCtx, timeline);
    }

    for (const due of timeline.pendingSupplierPayments.filter((p) => p.date === date.toISODate())) {
      await supplierService.recordPayment(due.purchaseId, { amount: due.amount, paymentMethod: 'bank_transfer', paymentDate: due.date, reference: `PAY-${int(10000, 99999)}` }, adminCtx);
    }

    // Everything that happens during the day runs in time order, so stock,
    // loyalty and payment ledgers read chronologically.
    const events = [];
    for (const due of timeline.pendingRefunds.filter((r) => r.date === date.toISODate())) {
      const at = date.set({ hour: 12, minute: int(0, 59) });
      events.push({
        at,
        run: async () => {
          await salesService.refundSale(due.saleId, { reason: pick(REFUND_REASONS) }, adminCtx, { at: toUtc(at), silent: true });
          timeline.stats.refunds += 1;
        },
      });
    }

    const hours = settings.get('system.business_hours')?.[String(date.weekday % 7)];
    if (hours?.open) {
      const opening = hhmm(date, hours.start);
      const closing = hhmm(date, hours.end);
      await restock(date, opening.minus({ minutes: 30 }), ref.products, ref.suppliers, adminCtx, timeline);

      const shifts = await db.withTransaction((conn) => recordAttendance(conn, ref.employees, date, now, onLeave, admin.id, branch.id, timeline));
      const busy = date.weekday >= 5 ? 0.4 : 0.25;
      const bookings = shifts.filter((s) => bookable.includes(s.employee)).flatMap((shift) => planDay(shift, date, customers, busy, timeline));

      for (const booking of bookings) {
        const finished = booking.end.plus({ minutes: 10 }) <= now;
        const started = booking.start <= now;
        let status = 'completed';
        if (!finished) status = started ? 'in_progress' : chance(0.75) ? 'confirmed' : 'pending';
        else if (chance(0.06)) status = 'cancelled';
        else if (chance(0.04)) status = 'no_show';
        events.push({
          at: booking.start.minus({ minutes: 1 }),
          run: async () => {
            booking.appointmentId = await db.withTransaction((conn) =>
              insertAppointment(conn, booking, { status: status === 'completed' ? 'in_progress' : status, adminId: frontDesk.id, branchId: branch.id, now }),
            );
            timeline.stats.appointments += 1;
          },
        });
        if (status !== 'completed') continue;
        const soldAt = DateTime.min(booking.end.plus({ minutes: int(2, 10) }), now);
        events.push({
          at: soldAt,
          run: async () => {
            const items = booking.services.map((sv) => ({ type: 'service', serviceId: sv.id, employeeId: booking.employee.id, quantity: 1 }));
            if (chance(0.2)) addRetail(items, ref.products);
            const sale = await sell({
              items, customerId: booking.customer.id, appointmentId: booking.appointmentId, soldAt, ctx: cashierCtx(),
              products: ref.products, recent: today.diff(date, 'days').days <= 21, timeline,
            });
            if (chance(0.004) && date < today.minus({ days: 3 })) timeline.pendingRefunds.push({ date: date.plus({ days: int(1, 2) }).toISODate(), saleId: sale.id });
          },
        });
      }

      // Walk-in counter sales (retail products, no booking).
      const walkIns = int(1, date.weekday >= 5 ? 4 : 3);
      for (let i = 0; i < walkIns; i += 1) {
        const soldAt = opening.plus({ minutes: int(60, Math.max(90, closing.diff(opening, 'minutes').minutes - 30)) });
        if (soldAt > now) continue;
        events.push({
          at: soldAt,
          run: async () => {
            const items = [];
            addRetail(items, ref.products, chance(0.25) ? 2 : 1);
            if (!items.length) return;
            const regulars = customers.filter((c) => c.joined < date);
            const known = regulars.length && chance(0.35) ? weighted(regulars, (c) => c.weight) : null;
            await sell({ items, customerId: known?.id, soldAt, ctx: cashierCtx(), products: ref.products, recent: false, timeline });
          },
        });
      }
      if (closing.plus({ minutes: 10 }) <= now) {
        events.push({ at: closing.plus({ minutes: 10 }), run: () => useSalonStock(closing.plus({ minutes: 10 }), ref.products, adminCtx) });
      }
    }

    events.sort((a, b) => a.at - b.at);
    for (const event of events) await event.run();
  }

  // Upcoming bookings for the next days (lighter further out).
  for (let d = 1; d <= UPCOMING_DAYS; d += 1) {
    const date = today.plus({ days: d });
    const hours = settings.get('system.business_hours')?.[String(date.weekday % 7)];
    if (!hours?.open) continue;
    const utilization = d <= 3 ? 0.3 : 0.15;
    for (const employee of bookable) {
      const day = employee.schedule.get(date.weekday % 7);
      if (!day || !day.is_working || onLeave(employee.id, date.toISODate())) continue;
      const shift = { employee, start: hhmm(date, day.start_time), end: hhmm(date, day.end_time) };
      for (const booking of planDay(shift, date, customers, utilization, timeline)) {
        await db.withTransaction((conn) =>
          insertAppointment(conn, booking, { status: chance(0.6) ? 'confirmed' : 'pending', adminId: frontDesk.id, branchId: branch.id, now }),
        );
        timeline.stats.appointments += 1;
      }
    }
  }

  // A customer's record always predates their first booking or purchase.
  await db.query(
    `UPDATE customers c
        LEFT JOIN (SELECT customer_id, MIN(created_at) AS first_at FROM appointments GROUP BY customer_id) a ON a.customer_id = c.id
        LEFT JOIN (SELECT customer_id, MIN(sold_at) AS first_at FROM sales WHERE customer_id IS NOT NULL GROUP BY customer_id) s ON s.customer_id = c.id
        SET c.created_at = LEAST(c.created_at, COALESCE(a.first_at, c.created_at), COALESCE(s.first_at, c.created_at)) - INTERVAL 1 HOUR
      WHERE c.is_demo = 1 AND (a.first_at < c.created_at OR s.first_at < c.created_at)`,
  );

  // Generation is not user activity: keep one audit entry, and let today's
  // stock check raise the current low-stock alerts.
  await db.query('DELETE FROM activity_logs WHERE id > ?', [firstLog]);
  await db.query('DELETE FROM notifications WHERE id > ?', [firstNotification]);
  await db.query(
    `INSERT INTO activity_logs (user_id, branch_id, action, entity_type, description, metadata, ip_address, user_agent)
     VALUES (?, ?, 'demo.generated', 'system', 'Demo activity generated for evaluation', ?, '127.0.0.1', 'demo-data-generator')`,
    [admin.id, branch.id, JSON.stringify(timeline.stats)],
  );
  await inventoryService.dailyStockCheck();

  const s = timeline.stats;
  console.log(
    `✔ Demo activity: ${s.customers} extra customers, ${s.appointments} appointments, ${s.sales} sales (${s.refunds} refunded), ` +
      `${s.purchases} purchases, ${s.expenses} expenses, ${s.salaries} salary payments, ${s.attendance} attendance records ` +
      `(${Math.round((Date.now() - began) / 1000)}s).`,
  );
};
