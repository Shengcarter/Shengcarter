'use strict';

const crypto = require('crypto');
const { DateTime } = require('luxon');
const config = require('../config');
const db = require('../config/database');
const logger = require('../config/logger');
const settings = require('./settingsService');
const { REPORTS, resolvePeriod, salesTotals, pct, change } = require('./reportService');
const { formatMoney, formatNumber, formatDate } = require('../utils/format');
const { timezone, todayLocal, localDateRange } = require('../utils/time');
const { createAnthropicProvider } = require('./insights/anthropicProvider');

/**
 * Business insights.
 *
 * The rule-based engine below always runs: it compares the chosen period with
 * the one before it and turns the figures into findings (trends, risks and
 * opportunities) with a suggested action. When an AI provider is configured
 * (AI_PROVIDER=anthropic + AI_API_KEY), it adds a written summary and
 * recommendations based on the same aggregated figures; if the provider is
 * missing, slow or fails, the rule-based summary is used instead.
 */

const AI_CACHE_MS = 3 * 60 * 60 * 1000;
const aiCache = new Map();

function aiProvider() {
  const { provider, apiKey, model } = config.integrations.ai;
  if (provider === 'anthropic' && apiKey) return createAnthropicProvider({ apiKey, model });
  return null;
}

const money = (v) => formatMoney(v);
const signed = (v) => `${v > 0 ? '+' : ''}${formatNumber(v, 1)}%`;
const abs = (v) => `${formatNumber(Math.abs(v), 1)}%`;
const firstName = (name) => String(name || '').split(' ')[0];

function weekdayOccurrences(from, to) {
  const counts = Array(7).fill(0);
  const zone = timezone();
  for (let d = DateTime.fromISO(from, { zone }); d <= DateTime.fromISO(to, { zone }); d = d.plus({ days: 1 })) counts[d.weekday - 1] += 1;
  return counts;
}

async function attachRate(branchId, start, end) {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS service_sales, SUM(has_product) AS with_product FROM (
       SELECT s.id, MAX(i.item_type = 'product') AS has_product, MAX(i.item_type = 'service') AS has_service
       FROM sales s JOIN sale_items i ON i.sale_id = s.id
       WHERE s.branch_id = ? AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ?
       GROUP BY s.id) x WHERE has_service = 1`,
    [branchId, start, end],
  );
  return { serviceSales: Number(row.service_sales || 0), withProduct: Number(row.with_product || 0), rate: pct(row.with_product || 0, row.service_sales || 0) };
}

async function monthForecast(branchId) {
  const zone = timezone();
  const today = DateTime.fromISO(todayLocal(), { zone });
  const monthStart = today.startOf('month');
  const mtd = localDateRange(monthStart.toISODate(), today.toISODate());
  const lastMonth = monthStart.minus({ months: 1 });
  const lm = localDateRange(lastMonth.toISODate(), lastMonth.endOf('month').toISODate());
  const [current, previous] = await Promise.all([salesTotals(branchId, mtd.start, mtd.end), salesTotals(branchId, lm.start, lm.end)]);
  const elapsed = today.day;
  const daysInMonth = today.daysInMonth;
  const projected = elapsed ? Math.round((current.gross / elapsed) * daysInMonth) : 0;
  return {
    month: today.toFormat('LLLL yyyy'),
    daysElapsed: elapsed,
    daysInMonth,
    toDate: current.gross,
    projected,
    lastMonth: previous.gross,
    change: change(projected, previous.gross),
  };
}

/** Turn report figures into findings. Each finding has a severity and an optional action link. */
function buildFindings({ period, sales, prevServices, services, customers, staff, inventory, expenses, attach, forecast }) {
  const out = [];
  const add = (finding) => out.push(finding);
  const s = sales.summary;

  // Revenue and ticket size
  if (s.change.gross === null) {
    add({ id: 'revenue', category: 'sales', severity: 'info', title: 'Not enough history to compare yet', detail: `Gross sales were ${money(s.gross)} from ${s.count} sales in this period. Trends appear once there is data for the previous ${period.days} days too.` });
  } else if (s.change.gross >= 5) {
    add({ id: 'revenue', category: 'sales', severity: 'positive', title: `Revenue is up ${abs(s.change.gross)}`, detail: `Gross sales reached ${money(s.gross)} compared with ${money(s.previous.gross)} in the previous ${period.days} days.`, metric: s.change.gross });
  } else if (s.change.gross <= -5) {
    add({ id: 'revenue', category: 'sales', severity: 'warning', title: `Revenue is down ${abs(s.change.gross)}`, detail: `Gross sales were ${money(s.gross)} against ${money(s.previous.gross)} in the previous ${period.days} days. Check bookings, staff availability and cancellations below.`, metric: s.change.gross });
  } else {
    add({ id: 'revenue', category: 'sales', severity: 'info', title: 'Revenue is steady', detail: `Gross sales of ${money(s.gross)} are within 5% of the previous ${period.days} days (${signed(s.change.gross)}).`, metric: s.change.gross });
  }
  if (s.change.averageSale !== null && Math.abs(s.change.averageSale) >= 5) {
    const up = s.change.averageSale > 0;
    add({
      id: 'ticket', category: 'sales', severity: up ? 'positive' : 'warning',
      title: `Average sale ${up ? 'rose' : 'fell'} to ${money(s.averageSale)}`,
      detail: up ? `Customers are spending ${abs(s.change.averageSale)} more per visit.` : `Customers are spending ${abs(s.change.averageSale)} less per visit. Suggest add-on treatments and retail products at checkout.`,
    });
  }

  // Busiest and quietest days, peak hours
  const occurrences = weekdayOccurrences(period.from, period.to);
  const days = sales.byWeekday
    .map((d, i) => ({ ...d, perDay: occurrences[i] ? d.gross / occurrences[i] : 0 }))
    .filter((d) => d.sales > 0);
  if (days.length >= 3) {
    const best = days.reduce((a, b) => (b.perDay > a.perDay ? b : a));
    const worst = days.reduce((a, b) => (b.perDay < a.perDay ? b : a));
    if (best.perDay > worst.perDay * 1.3) {
      add({
        id: 'weekdays', category: 'sales', severity: 'info', kind: 'opportunity',
        title: `${best.day}s earn ${Math.round((best.perDay / worst.perDay - 1) * 100)}% more than ${worst.day}s`,
        detail: `An average ${best.day} brings ${money(best.perDay)}; an average ${worst.day} brings ${money(worst.perDay)}. A ${worst.day} offer (for example a mid-week treatment discount) can fill quieter chairs.`,
      });
    }
  }
  const peaks = [...sales.byHour].sort((a, b) => b.sales - a.sales).slice(0, 2).filter((h) => h.sales > 0);
  if (peaks.length) {
    add({
      id: 'peak-hours', category: 'operations', severity: 'info',
      title: `Busiest checkout times: ${peaks.map((p) => p.hour).join(' and ')}`,
      detail: `${formatNumber(peaks.reduce((sum, p) => sum + p.sales, 0))} sales were completed in these hours. Keep the front desk and enough stylists available, and schedule breaks outside them.`,
    });
  }

  // Services: growth, decline, cancellations
  const prev = new Map(prevServices.services.map((r) => [r.id, r]));
  const compared = services.services
    .filter((r) => r.revenue > 0 || prev.get(r.id)?.revenue > 0)
    .map((r) => ({ ...r, previous: prev.get(r.id)?.revenue || 0, change: change(r.revenue, prev.get(r.id)?.revenue || 0) }));
  const growing = compared.filter((r) => r.change !== null && r.change >= 15 && r.share >= 3).sort((a, b) => b.revenue - b.previous - (a.revenue - a.previous))[0];
  const declining = compared.filter((r) => r.change !== null && r.change <= -20 && r.previous > 0).sort((a, b) => a.revenue - a.previous - (b.revenue - b.previous))[0];
  if (growing) add({ id: 'service-growth', category: 'services', severity: 'positive', title: `${growing.name} is growing (${signed(growing.change)})`, detail: `It earned ${money(growing.revenue)} against ${money(growing.previous)} before. Feature it on social media and make sure enough staff can perform it.` });
  if (declining) add({ id: 'service-decline', category: 'services', severity: 'warning', title: `${declining.name} is declining (${signed(declining.change)})`, detail: `It earned ${money(declining.revenue)} compared with ${money(declining.previous)} before. Review its price, promote it, or check whether the staff who perform it were available.`, action: { label: 'Review services', to: '/services' } });
  if (services.categories[0]?.revenue) {
    const top = services.categories[0];
    add({ id: 'category-mix', category: 'services', severity: 'info', title: `${top.category} brings ${formatNumber(top.share, 1)}% of service revenue`, detail: `${money(top.revenue)} from ${formatNumber(top.sold)} services. ${top.share > 50 ? 'Relying on one category is a risk; grow the others with bundles.' : 'Your service mix is well spread.'}` });
  }
  if (services.summary.bookings >= 10 && services.summary.cancellationRate >= 8) {
    const reminders = settings.get('notifications.reminders_enabled');
    add({
      id: 'cancellations', category: 'appointments', severity: services.summary.cancellationRate >= 15 ? 'critical' : 'warning',
      title: `${formatNumber(services.summary.cancellationRate, 1)}% of bookings were cancelled or missed`,
      detail: `${reminders ? 'Reminders are on; consider a small deposit for long services and confirm by WhatsApp the day before.' : 'Automatic appointment reminders are switched off — turning them on usually reduces no-shows.'}`,
      action: reminders ? { label: 'View appointments', to: '/appointments?view=list' } : { label: 'Reminder settings', to: '/settings/notifications' },
    });
  }

  // Customers
  const c = customers.summary;
  if (c.previousActive >= 10) {
    if (c.retentionRate >= 60) add({ id: 'retention', category: 'customers', severity: 'positive', title: `${formatNumber(c.retentionRate, 1)}% of customers came back`, detail: `${c.retainedCustomers} of the ${c.previousActive} customers from the previous period returned in this one.` });
    else add({ id: 'retention', category: 'customers', severity: 'warning', title: `Only ${formatNumber(c.retentionRate, 1)}% of customers came back`, detail: `${c.retainedCustomers} of ${c.previousActive} customers from the previous period returned. Book the next visit at checkout and follow up after a few weeks.` });
  }
  if (c.atRisk > 0) {
    add({ id: 'at-risk', category: 'customers', severity: 'warning', kind: 'opportunity', title: `${c.atRisk} regular customer${c.atRisk === 1 ? ' has' : 's have'} not visited for 60+ days`, detail: 'Send them a personal message or a comeback offer before they settle with another salon.', action: { label: 'See customers', to: '/reports?tab=customers' } });
  }
  if (c.newChange !== null && Math.abs(c.newChange) >= 20) {
    add({ id: 'new-customers', category: 'customers', severity: c.newChange > 0 ? 'positive' : 'warning', title: `New customers ${c.newChange > 0 ? 'up' : 'down'} ${abs(c.newChange)}`, detail: `${c.newCustomers} new customers registered in this period.${c.newChange < 0 ? ' Referral rewards and social media posts are cheap ways to bring more in.' : ''}` });
  }
  if (sales.summary.count >= 20 && c.walkInShare >= 25) {
    add({ id: 'walk-ins', category: 'customers', severity: 'info', kind: 'opportunity', title: `${formatNumber(c.walkInShare, 1)}% of sales had no customer attached`, detail: 'Register walk-in customers at checkout so they earn loyalty points and can be invited back.' });
  }

  // Staff
  const bookable = staff.staff.filter((r) => r.bookable && r.utilization !== null && (r.appointments || r.services));
  if (bookable.length) {
    const avg = staff.summary.averageUtilization;
    if (avg < 40) add({ id: 'utilization', category: 'staff', severity: 'info', kind: 'opportunity', title: `Stylists are booked ${formatNumber(avg, 1)}% of their scheduled time`, detail: 'There is room for more appointments. Promote online and WhatsApp booking and quiet-day offers, or adjust schedules to demand.' });
    else if (avg > 85) add({ id: 'utilization', category: 'staff', severity: 'warning', title: `Stylists are ${formatNumber(avg, 1)}% booked`, detail: 'The team is close to capacity. Consider extending hours on busy days or adding a stylist.' });
    const top = staff.staff[0];
    if (top?.revenue) add({ id: 'top-staff', category: 'staff', severity: 'positive', title: `${top.name} led the team with ${money(top.revenue)}`, detail: `${formatNumber(top.services)} services performed${top.utilization !== null ? `, ${formatNumber(top.utilization, 1)}% booked` : ''}.` });
  }
  if (staff.summary.lateArrivals >= 5) {
    add({ id: 'punctuality', category: 'staff', severity: 'warning', title: `${staff.summary.lateArrivals} late arrivals recorded`, detail: 'Late starts delay the first appointments of the day. Review the attendance tab with the team.', action: { label: 'Attendance', to: '/employees?tab=attendance' } });
  }

  // Inventory
  const inv = inventory;
  if (inv.lowStock.length) {
    add({ id: 'low-stock', category: 'inventory', severity: inv.lowStock.some((p) => p.inStock === 0) ? 'critical' : 'warning', title: `${inv.lowStock.length} product${inv.lowStock.length === 1 ? ' is' : 's are'} at or below minimum stock`, detail: inv.lowStock.slice(0, 4).map((p) => `${p.name} (${p.inStock} left)`).join(', '), action: { label: 'Reorder', to: '/inventory' } });
  }
  const runningOut = inv.topProducts.filter((p) => p.daysOfCover !== null && p.daysOfCover < 14 && p.inStock > 0).slice(0, 3);
  if (runningOut.length) {
    add({ id: 'days-of-cover', category: 'inventory', severity: 'warning', title: 'Best sellers will run out soon', detail: runningOut.map((p) => `${p.name}: about ${p.daysOfCover} days left`).join('; '), action: { label: 'Create purchase', to: '/suppliers' } });
  }
  if (inv.slowMovers.length) {
    const tied = inv.slowMovers.reduce((sum, p) => sum + p.stockValue, 0);
    add({ id: 'slow-movers', category: 'inventory', severity: 'info', kind: 'opportunity', title: `${money(tied)} of stock did not sell`, detail: `${inv.slowMovers.length} retail product${inv.slowMovers.length === 1 ? '' : 's'} had no sales in this period (${inv.slowMovers.slice(0, 3).map((p) => p.name).join(', ')}). Bundle them with services or run a promotion.` });
  }
  if (attach.serviceSales >= 20) {
    add({
      id: 'attach-rate', category: 'sales', severity: attach.rate < 15 ? 'info' : 'positive', kind: attach.rate < 15 ? 'opportunity' : undefined,
      title: `${formatNumber(attach.rate, 1)}% of service visits included a product`,
      detail: attach.rate < 15 ? 'Recommending the products used during the service (shampoo, oils, polish) is the easiest way to raise the average sale.' : 'Retail recommendations are working well.',
    });
  }

  // Money out
  const e = expenses.summary;
  if (e.total > 0 && sales.summary.net > 0) {
    if (e.shareOfSales >= 70) add({ id: 'expense-ratio', category: 'finance', severity: 'critical', title: `Expenses are ${formatNumber(e.shareOfSales, 1)}% of net sales`, detail: `${money(e.total)} spent against ${money(sales.summary.net)} of net sales. Review the largest category (${e.largestCategory}).`, action: { label: 'Expenses', to: '/expenses' } });
    else if (e.change !== null && e.change >= 25) add({ id: 'expense-growth', category: 'finance', severity: 'warning', title: `Expenses rose ${abs(e.change)}`, detail: `${money(e.total)} compared with ${money(e.previousTotal)} in the previous period; the largest category was ${e.largestCategory}.`, action: { label: 'Expenses', to: '/expenses' } });
  }
  if (sales.summary.outstanding > 0) {
    add({ id: 'outstanding', category: 'finance', severity: 'info', title: `${money(sales.summary.outstanding)} is still owed by customers`, detail: 'Collect outstanding balances at the next visit or send a reminder.', action: { label: 'Sales with balances', to: '/pos/sales' } });
  }
  if (forecast.projected > 0 && forecast.daysElapsed >= 5 && forecast.change !== null) {
    add({
      id: 'forecast', category: 'sales', severity: forecast.change >= 0 ? 'positive' : 'warning',
      title: `${forecast.month} is on track for about ${money(forecast.projected)}`,
      detail: `${money(forecast.toDate)} after ${forecast.daysElapsed} of ${forecast.daysInMonth} days, ${signed(forecast.change)} against last month's ${money(forecast.lastMonth)} (projection at the current daily rate).`,
    });
  }

  const order = { critical: 0, warning: 1, positive: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

function ruleSummary(findings, sales, period) {
  const risks = findings.filter((f) => f.severity === 'critical' || f.severity === 'warning');
  const wins = findings.filter((f) => f.severity === 'positive');
  const parts = [`Over the ${period.days} days from ${formatDate(period.from)} to ${formatDate(period.to)}, the salon made ${formatNumber(sales.summary.count)} sales worth ${money(sales.summary.gross)}.`];
  if (wins.length) parts.push(`Going well: ${wins.slice(0, 2).map((w) => w.title).join('; ')}.`);
  if (risks.length) parts.push(`Needs attention: ${risks.slice(0, 2).map((r) => r.title).join('; ')}.`);
  return parts.join(' ');
}

/** Aggregated, non-personal figures shared with the AI provider. */
function factsFor({ period, sales, services, customers, staff, inventory, expenses, attach, forecast, findings }) {
  return {
    period: { from: period.from, to: period.to, days: period.days },
    currency: settings.get('financial.currency_code') || 'TZS',
    sales: {
      gross: sales.summary.gross, net: sales.summary.net, count: sales.summary.count, averageSale: sales.summary.averageSale,
      changePercent: sales.summary.change, outstanding: sales.summary.outstanding, refunds: sales.summary.refunds,
      byWeekday: sales.byWeekday, peakHours: [...sales.byHour].sort((a, b) => b.sales - a.sales).slice(0, 3),
      paymentMix: sales.paymentMethods.map((m) => ({ method: m.method, net: m.net })),
      retailAttachRatePercent: attach.rate,
    },
    services: {
      topByRevenue: services.services.slice(0, 6).map((r) => ({ name: r.name, category: r.category, sold: r.sold, revenue: r.revenue, sharePercent: r.share })),
      categories: services.categories.map((r) => ({ category: r.category, revenue: r.revenue, sharePercent: r.share })),
      cancellationAndNoShowPercent: services.summary.cancellationRate,
    },
    customers: {
      new: customers.summary.newCustomers, active: customers.summary.activeCustomers, returning: customers.summary.returningCustomers,
      retentionPercent: customers.summary.retentionRate, atRiskRegulars: customers.summary.atRisk, walkInSharePercent: customers.summary.walkInShare,
      averageSpendPerCustomer: customers.summary.averageSpend,
    },
    staff: staff.staff.filter((r) => r.bookable).map((r) => ({ name: firstName(r.name), role: r.jobTitle, services: r.services, revenue: r.revenue, utilizationPercent: r.utilization, late: r.late, absent: r.absent })),
    inventory: {
      lowStock: inventory.lowStock.map((p) => ({ product: p.name, inStock: p.inStock, minimum: p.minStock })),
      slowMovers: inventory.slowMovers.length, slowMoverStockValue: inventory.slowMovers.reduce((sum, p) => sum + p.stockValue, 0),
      productProfit: inventory.summary.productProfit,
    },
    expenses: { total: expenses.summary.total, changePercent: expenses.summary.change, sharePercentOfNetSales: expenses.summary.shareOfSales, topCategories: expenses.categories.slice(0, 4) },
    monthForecast: forecast,
    ruleFindings: findings.map((f) => f.title),
  };
}

async function insights(params, ctx, { refresh = false } = {}) {
  const today = todayLocal();
  const period = resolvePeriod({
    from: params.from || DateTime.fromISO(today).minus({ days: 29 }).toISODate(),
    to: params.to || today,
  });
  const range = { from: period.from, to: period.to };
  const prevRange = { from: period.previous.from, to: period.previous.to };
  const [sales, services, prevServices, customers, staff, inventory, expenses, attach, forecast] = await Promise.all([
    REPORTS.sales.build(range, ctx),
    REPORTS.services.build(range, ctx),
    REPORTS.services.build(prevRange, ctx),
    REPORTS.customers.build(range, ctx),
    REPORTS.staff.build(range, ctx),
    REPORTS.inventory.build(range, ctx),
    REPORTS.expenses.build(range, ctx),
    attachRate(ctx.branchId, period.start, period.end),
    monthForecast(ctx.branchId),
  ]);
  const findings = buildFindings({ period, sales, prevServices, services, customers, staff, inventory, expenses, attach, forecast });

  const result = {
    period: { from: period.from, to: period.to, days: period.days },
    generatedAt: new Date().toISOString(),
    source: 'rules',
    summary: ruleSummary(findings, sales, period),
    recommendations: findings.filter((f) => f.kind === 'opportunity' || f.severity === 'warning' || f.severity === 'critical').slice(0, 5)
      .map((f) => ({ title: f.title, detail: f.detail, priority: f.severity === 'critical' ? 'high' : f.severity === 'warning' ? 'medium' : 'low' })),
    findings,
    forecast,
    highlights: {
      gross: sales.summary.gross, change: sales.summary.change.gross, averageSale: sales.summary.averageSale,
      retention: customers.summary.retentionRate, cancellationRate: services.summary.cancellationRate, utilization: staff.summary.averageUtilization,
    },
    ai: { configured: Boolean(aiProvider()) },
  };

  const provider = aiProvider();
  if (provider && sales.summary.count > 0) {
    const facts = factsFor({ period, sales, services, customers, staff, inventory, expenses, attach, forecast, findings });
    const key = `${ctx.branchId}|${period.from}|${period.to}|${crypto.createHash('sha1').update(JSON.stringify(facts)).digest('hex')}`;
    const cached = aiCache.get(key);
    try {
      let narrative = !refresh && cached && Date.now() - cached.at < AI_CACHE_MS ? cached.value : null;
      if (!narrative) {
        narrative = await provider.narrate(facts);
        aiCache.set(key, { at: Date.now(), value: narrative });
        if (aiCache.size > 50) aiCache.delete(aiCache.keys().next().value);
      }
      Object.assign(result, { source: provider.name, summary: narrative.summary, recommendations: narrative.recommendations });
      result.ai = { configured: true, model: narrative.model, cached: Boolean(cached && narrative === cached.value) };
    } catch (error) {
      logger.warn({ err: { message: error.message, status: error.status } }, 'AI insights unavailable — using rule-based summary');
      result.ai = { configured: true, error: 'The AI summary is unavailable right now; showing the built-in analysis.' };
    }
  }
  return result;
}

module.exports = { insights };
