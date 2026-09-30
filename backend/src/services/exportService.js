'use strict';

const { DateTime } = require('luxon');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const settings = require('./settingsService');
const { business, logoPath, toBuffer, SYSTEM_NAME } = require('./documentService');
const { formatMoney, formatNumber, formatDate, formatDateTime, titleCase } = require('../utils/format');
const { timezone } = require('../utils/time');

/**
 * Report exports (PDF, Excel, CSV). A report is first turned into a neutral
 * document — summary figures plus tables with typed columns — and each format
 * renders that document. Every export carries the system name, the business
 * details, the report title, the period, the branch and when/who generated it.
 */

// ---- Report → document ------------------------------------------------------------------------

function periodLabel(value, groupBy) {
  const dt = DateTime.fromISO(value);
  if (groupBy === 'month') return dt.toFormat('LLLL yyyy');
  if (groupBy === 'year') return dt.toFormat('yyyy');
  if (groupBy === 'week') return `Week of ${dt.toFormat('dd LLL yyyy')}`;
  return dt.toFormat('ccc dd LLL yyyy');
}

const col = (key, label, format = 'text') => ({ key, label, format });

const DOCUMENTS = {
  sales: (r) => ({
    summary: [
      ['Transactions', r.summary.count, 'number'],
      ['Gross sales (incl. tax)', r.summary.gross, 'money'],
      ['Tax collected', r.summary.tax, 'money'],
      ['Net sales', r.summary.net, 'money'],
      ['Discounts given', r.summary.discounts, 'money'],
      ['Cost of goods sold', r.summary.cogs, 'money'],
      ['Gross profit', r.summary.grossProfit, 'money'],
      ['Average sale', r.summary.averageSale, 'money'],
      ['Outstanding balances', r.summary.outstanding, 'money'],
      ['Refunded sales', `${r.summary.refunds.count} (${formatMoney(r.summary.refunds.amount)})`, 'text'],
    ],
    tables: [
      { title: 'Sales by period', columns: [col('period', 'Period', 'period'), col('sales', 'Sales', 'number'), col('gross', 'Gross sales', 'money'), col('net', 'Net sales', 'money')], rows: r.series },
      { title: 'Payment methods', columns: [col('method', 'Method', 'title'), col('count', 'Payments', 'number'), col('received', 'Received', 'money'), col('refunded', 'Refunded', 'money'), col('net', 'Net collected', 'money')], rows: r.paymentMethods },
      { title: 'Services', columns: [col('name', 'Service'), col('category', 'Category'), col('quantity', 'Sold', 'number'), col('revenue', 'Revenue (net)', 'money'), col('share', 'Share', 'percent')], rows: r.services },
      { title: 'Staff', columns: [col('name', 'Staff member'), col('services', 'Services', 'number'), col('revenue', 'Revenue (net)', 'money'), col('commission', 'Commission', 'money')], rows: r.staff },
      { title: 'Products', columns: [col('name', 'Product'), col('quantity', 'Units', 'number'), col('revenue', 'Revenue (net)', 'money'), col('cost', 'Cost', 'money'), col('profit', 'Profit', 'money'), col('margin', 'Margin', 'percent')], rows: r.products },
      { title: 'Sales by weekday', columns: [col('day', 'Day'), col('sales', 'Sales', 'number'), col('gross', 'Gross sales', 'money')], rows: r.byWeekday },
    ],
  }),
  customers: (r) => ({
    summary: [
      ['Customers on record', r.summary.totalCustomers, 'number'],
      ['New customers', r.summary.newCustomers, 'number'],
      ['Active customers', r.summary.activeCustomers, 'number'],
      ['First-time buyers', r.summary.firstTimeCustomers, 'number'],
      ['Returning customers', r.summary.returningCustomers, 'number'],
      ['Retention rate', r.summary.retentionRate, 'percent'],
      ['Walk-in share of sales', r.summary.walkInShare, 'percent'],
      ['Average spend per customer', r.summary.averageSpend, 'money'],
      ['Visits per customer', r.summary.visitsPerCustomer, 'decimal'],
      ['At-risk regulars (60+ days away)', r.summary.atRisk, 'number'],
    ],
    tables: [
      { title: 'New customers by period', columns: [col('period', 'Period', 'period'), col('customers', 'New customers', 'number')], rows: r.series },
      { title: 'Top customers', columns: [col('code', 'Code'), col('name', 'Customer'), col('phone', 'Phone'), col('visits', 'Visits', 'number'), col('spent', 'Spent', 'money'), col('lastVisit', 'Last visit', 'datetime'), col('tier', 'Tier')], rows: r.topCustomers },
      { title: 'Regulars at risk', columns: [col('code', 'Code'), col('name', 'Customer'), col('phone', 'Phone'), col('visits', 'Visits', 'number'), col('spent', 'Lifetime spend', 'money'), col('lastVisit', 'Last visit', 'datetime')], rows: r.atRisk },
      { title: 'Loyalty tiers', columns: [col('tier', 'Tier'), col('customers', 'Customers', 'number')], rows: r.tiers },
    ],
  }),
  services: (r) => ({
    summary: [
      ['Services sold', r.summary.servicesSold, 'number'],
      ['Service revenue (net)', r.summary.revenue, 'money'],
      ['Bookings', r.summary.bookings, 'number'],
      ['Cancellation & no-show rate', r.summary.cancellationRate, 'percent'],
      ['Top service', r.summary.topService || '—', 'text'],
    ],
    tables: [
      {
        title: 'Service performance',
        columns: [col('name', 'Service'), col('category', 'Category'), col('bookings', 'Bookings', 'number'), col('cancellationRate', 'Cancelled / no-show', 'percent'),
          col('sold', 'Sold', 'number'), col('averagePrice', 'Avg price', 'money'), col('revenue', 'Revenue (net)', 'money'), col('share', 'Share', 'percent')],
        rows: r.services,
      },
      { title: 'Categories', columns: [col('category', 'Category'), col('bookings', 'Bookings', 'number'), col('sold', 'Sold', 'number'), col('revenue', 'Revenue (net)', 'money'), col('share', 'Share', 'percent')], rows: r.categories },
    ],
  }),
  staff: (r) => ({
    summary: [
      ['Staff', r.summary.employees, 'number'],
      ['Services performed', r.summary.servicesPerformed, 'number'],
      ['Service revenue (net)', r.summary.serviceRevenue, 'money'],
      ['Commission earned', r.summary.commission, 'money'],
      ['Average utilisation', r.summary.averageUtilization, 'percent'],
      ['Late arrivals', r.summary.lateArrivals, 'number'],
      ['Absences', r.summary.absences, 'number'],
      ['Top performer', r.summary.topPerformer || '—', 'text'],
    ],
    tables: [
      {
        title: 'Staff performance',
        columns: [col('name', 'Staff member'), col('jobTitle', 'Role'), col('appointments', 'Appts', 'number'), col('noShows', 'No-shows', 'number'), col('services', 'Services', 'number'),
          col('revenue', 'Revenue (net)', 'money'), col('commission', 'Commission', 'money'), col('bookedHours', 'Booked h', 'decimal'), col('utilization', 'Utilisation', 'percent'),
          col('present', 'Present', 'number'), col('late', 'Late', 'number'), col('absent', 'Absent', 'number')],
        rows: r.staff,
      },
    ],
  }),
  inventory: (r) => ({
    summary: [
      ['Active products', r.summary.products, 'number'],
      ['Units on hand', r.summary.units, 'number'],
      ['Stock value (cost)', r.summary.costValue, 'money'],
      ['Stock value (retail)', r.summary.retailValue, 'money'],
      ['Low stock / out of stock', `${r.summary.lowStock} / ${r.summary.outOfStock}`, 'text'],
      ['Units sold', r.summary.unitsSold, 'number'],
      ['Product revenue (net)', r.summary.productRevenue, 'money'],
      ['Product profit', r.summary.productProfit, 'money'],
      ['Purchases received', `${r.summary.purchases} (${formatMoney(r.summary.purchasesTotal)})`, 'text'],
    ],
    tables: [
      { title: 'Stock value by category', columns: [col('category', 'Category'), col('products', 'Products', 'number'), col('units', 'Units', 'number'), col('costValue', 'Cost value', 'money'), col('retailValue', 'Retail value', 'money')], rows: r.valuation },
      { title: 'Best-selling products', columns: [col('name', 'Product'), col('sku', 'SKU'), col('quantity', 'Sold', 'number'), col('revenue', 'Revenue (net)', 'money'), col('profit', 'Profit', 'money'), col('margin', 'Margin', 'percent'), col('inStock', 'In stock', 'number'), col('daysOfCover', 'Days of cover', 'number')], rows: r.topProducts },
      { title: 'Low stock', columns: [col('name', 'Product'), col('sku', 'SKU'), col('inStock', 'In stock', 'number'), col('minStock', 'Minimum', 'number')], rows: r.lowStock },
      { title: 'Slow movers (no sales in period)', columns: [col('name', 'Product'), col('sku', 'SKU'), col('inStock', 'In stock', 'number'), col('stockValue', 'Stock value', 'money'), col('lastSold', 'Last sold', 'datetime')], rows: r.slowMovers },
      { title: 'Stock movements', columns: [col('type', 'Movement', 'title'), col('entries', 'Entries', 'number'), col('quantity', 'Net units', 'number'), col('value', 'Value (cost)', 'money')], rows: r.movements },
    ],
  }),
  expenses: (r) => ({
    summary: [
      ['Total expenses', r.summary.total, 'money'],
      ['Entries', r.summary.count, 'number'],
      ['Previous period', r.summary.previousTotal, 'money'],
      ['Average per day', r.summary.averagePerDay, 'money'],
      ['Share of net sales', r.summary.shareOfSales, 'percent'],
      ['Largest category', r.summary.largestCategory || '—', 'text'],
    ],
    tables: [
      { title: 'By category', columns: [col('category', 'Category'), col('count', 'Entries', 'number'), col('total', 'Amount', 'money'), col('share', 'Share', 'percent')], rows: r.categories },
      { title: 'By period', columns: [col('period', 'Period', 'period'), col('total', 'Amount', 'money')], rows: r.series },
      { title: 'Top vendors', columns: [col('vendor', 'Vendor'), col('count', 'Entries', 'number'), col('total', 'Amount', 'money')], rows: r.vendors },
      { title: 'Payment methods', columns: [col('method', 'Method', 'title'), col('total', 'Amount', 'money')], rows: r.paymentMethods },
    ],
  }),
  profit: (r) => ({
    summary: [
      ['Gross sales (incl. tax)', r.summary.grossSales, 'money'],
      ['Less: tax collected', r.summary.tax, 'money'],
      ['Net sales', r.summary.netSales, 'money'],
      ['Less: cost of goods sold', r.summary.cogs, 'money'],
      ['Gross profit', r.summary.grossProfit, 'money'],
      ['Gross margin', r.summary.grossMargin, 'percent'],
      ['Less: expenses', r.summary.expenses, 'money'],
      ['Net profit (cash paid out)', r.summary.netProfit, 'money'],
      ['Net margin', r.summary.netMargin, 'percent'],
      ['Commission earned, not yet paid', r.summary.unpaidCommission, 'money'],
      ['Running costs (excluding commission payouts)', r.summary.afterCommission.runningCosts, 'money'],
      ['Commission earned in the period', r.summary.afterCommission.commission, 'money'],
      ['Payout bonuses less deductions', r.summary.afterCommission.bonuses, 'money'],
      ['Profit after commission', r.summary.afterCommission.profit, 'money'],
      ['Margin after commission', r.summary.afterCommission.margin, 'percent'],
    ],
    tables: [
      { title: 'Profit by period', columns: [col('period', 'Period', 'period'), col('net', 'Net sales', 'money'), col('cogs', 'COGS', 'money'), col('expenses', 'Expenses', 'money'), col('profit', 'Net profit', 'money')], rows: r.series },
      { title: 'Expenses by category', columns: [col('category', 'Category'), col('total', 'Amount', 'money'), col('share', 'Share', 'percent')], rows: r.expenses },
    ],
    notes: [
      'Net profit is on a cash basis: staff commission counts as an expense when it is paid out.',
      'Profit after commission counts commission when it is earned, paid or not, so it does not jump on payday. Once all commission for the period is paid out, it equals net profit.',
      'Stock purchases become cost of goods sold when the products are sold.',
    ],
  }),
  branches: (r) => ({
    summary: [
      ['Branches', r.summary.branches, 'number'],
      ['Gross sales', r.summary.grossSales, 'money'],
      ['Net sales', r.summary.netSales, 'money'],
      ['Expenses', r.summary.expenses, 'money'],
      ['Net profit', r.summary.netProfit, 'money'],
    ],
    tables: [
      {
        title: 'Branch comparison',
        columns: [col('name', 'Branch'), col('sales', 'Sales', 'number'), col('grossSales', 'Gross sales', 'money'), col('share', 'Share', 'percent'), col('averageSale', 'Avg sale', 'money'),
          col('expenses', 'Expenses', 'money'), col('netProfit', 'Net profit', 'money'), col('customers', 'Customers', 'number'), col('appointments', 'Appointments', 'number')],
        rows: r.branches,
      },
    ],
  }),
};

function meta(title, report, ctx) {
  const b = business();
  return {
    title,
    business: b,
    period: `${formatDate(report.period.from)} – ${formatDate(report.period.to)}`,
    groupBy: report.period.groupBy,
    branch: ctx.branchName || '',
    generatedAt: DateTime.now().setZone(timezone()).toFormat(settings.get('system.time_format') === '12h' ? 'dd LLL yyyy, h:mm a' : 'dd LLL yyyy, HH:mm'),
    generatedBy: ctx.user?.fullName || '',
    currency: settings.get('financial.currency_code') || 'TZS',
    decimals: Number(settings.get('financial.currency_decimals') ?? 0),
  };
}

function display(value, format, info) {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'money':
      return formatMoney(value);
    case 'number':
      return formatNumber(value);
    case 'decimal':
      return formatNumber(value, 1);
    case 'percent':
      return `${formatNumber(value, 1)}%`;
    case 'period':
      return periodLabel(value, info.groupBy);
    case 'datetime':
      return formatDateTime(value);
    case 'title':
      return titleCase(value);
    default:
      return String(value);
  }
}

const isNumeric = (format) => ['money', 'number', 'decimal', 'percent'].includes(format);

// ---- CSV --------------------------------------------------------------------------------------

/** Quote a CSV cell and neutralise spreadsheet formula injection. */
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(doc, info) {
  const lines = [];
  const row = (...cells) => lines.push(cells.map(csvCell).join(','));
  row(SYSTEM_NAME);
  row(info.business.name);
  if (info.business.address) row(info.business.address);
  row(info.title);
  row('Period', info.period);
  if (info.branch) row('Branch', info.branch);
  row('Generated', `${info.generatedAt}${info.generatedBy ? ` by ${info.generatedBy}` : ''}`);
  row('Currency', info.currency);
  lines.push('');
  row('Summary');
  for (const [label, value, format] of doc.summary) {
    const unit = format === 'money' ? ` (${info.currency})` : format === 'percent' ? ' (%)' : '';
    row(`${label}${unit}`, isNumeric(format) ? value : display(value, format, info));
  }
  for (const table of doc.tables) {
    lines.push('');
    row(table.title);
    row(...table.columns.map((c) => (c.format === 'money' ? `${c.label} (${info.currency})` : c.format === 'percent' ? `${c.label} (%)` : c.label)));
    if (!table.rows.length) row('No data for this period');
    for (const r of table.rows) {
      row(...table.columns.map((c) => (isNumeric(c.format) ? (r[c.key] ?? '') : r[c.key] === null || r[c.key] === undefined ? '' : display(r[c.key], c.format, info))));
    }
  }
  for (const note of doc.notes || []) row(`Note: ${note}`);
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

// ---- Excel ------------------------------------------------------------------------------------

const BRAND = 'FFC20E57';
const BRAND_LIGHT = 'FFFCE4EE';

function moneyFormat(decimals) {
  return decimals ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
}

function sheetName(title, used) {
  let name = title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet';
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${title.slice(0, 27)} (${n++})`;
  used.add(name.toLowerCase());
  return name;
}

function header(ws, info) {
  ws.addRow([SYSTEM_NAME]).font = { bold: true, color: { argb: BRAND }, size: 9 };
  ws.addRow([info.business.name]).font = { bold: true, size: 14 };
  const contact = [info.business.address, info.business.phone, info.business.email, info.business.tin ? `TIN ${info.business.tin}` : null].filter(Boolean).join(' · ');
  if (contact) ws.addRow([contact]).font = { color: { argb: 'FF666666' }, size: 9 };
  ws.addRow([]);
  ws.addRow([info.title]).font = { bold: true, size: 13 };
  ws.addRow([`Period: ${info.period}${info.branch ? ` · Branch: ${info.branch}` : ''}`]);
  ws.addRow([`Generated ${info.generatedAt}${info.generatedBy ? ` by ${info.generatedBy}` : ''} · Amounts in ${info.currency}`]).font = { color: { argb: 'FF666666' }, size: 9 };
  ws.addRow([]);
}

async function toXlsx(doc, info) {
  const wb = new ExcelJS.Workbook();
  wb.creator = SYSTEM_NAME;
  wb.created = new Date();
  wb.title = info.title;
  const used = new Set();
  const numFmt = { money: moneyFormat(info.decimals), number: '#,##0', decimal: '#,##0.0', percent: '0.0%' };

  const summary = wb.addWorksheet(sheetName('Summary', used));
  header(summary, info);
  const head = summary.addRow(['Measure', 'Value']);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } }; });
  for (const [label, value, format] of doc.summary) {
    const r = summary.addRow([label, isNumeric(format) ? (format === 'percent' ? Number(value) / 100 : Number(value)) : display(value, format, info)]);
    if (numFmt[format]) r.getCell(2).numFmt = numFmt[format];
  }
  for (const note of doc.notes || []) summary.addRow([`Note: ${note}`]).font = { italic: true, color: { argb: 'FF666666' } };
  summary.getColumn(1).width = 38;
  summary.getColumn(2).width = 24;

  for (const table of doc.tables) {
    const ws = wb.addWorksheet(sheetName(table.title, used));
    header(ws, { ...info, title: `${info.title} — ${table.title}` });
    const headerRow = ws.addRow(table.columns.map((c) => (c.format === 'money' ? `${c.label} (${info.currency})` : c.label)));
    headerRow.font = { bold: true };
    headerRow.eachCell((cell, i) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
      cell.alignment = { horizontal: isNumeric(table.columns[i - 1].format) ? 'right' : 'left' };
    });
    ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
    if (!table.rows.length) ws.addRow(['No data for this period']).font = { italic: true };
    for (const r of table.rows) {
      const values = table.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined) return null;
        if (c.format === 'percent') return Number((Number(v) / 100).toFixed(6));
        if (isNumeric(c.format)) return Number(v);
        if (c.format === 'datetime') return formatDateTime(v);
        return display(v, c.format, info);
      });
      const added = ws.addRow(values);
      table.columns.forEach((c, i) => { if (numFmt[c.format]) added.getCell(i + 1).numFmt = numFmt[c.format]; });
    }
    table.columns.forEach((c, i) => {
      const longest = Math.max(c.label.length + 6, ...table.rows.slice(0, 200).map((r) => String(display(r[c.key], c.format, info)).length));
      ws.getColumn(i + 1).width = Math.min(48, Math.max(10, longest + 2));
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- PDF --------------------------------------------------------------------------------------

const INK = '#191A2E';
const MUTED = '#666666';
const PDF_BRAND = '#C20E57';
const HEAD_FILL = '#FCE4EE';
const ZEBRA = '#FDF7F8';

/** Trim text with an ellipsis so it fits a table cell (uses the current font). */
function fit(pdf, text, maxWidth) {
  const value = String(text);
  if (pdf.widthOfString(value) <= maxWidth) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pdf.widthOfString(`${value.slice(0, mid)}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${value.slice(0, lo)}…`;
}

/**
 * Column widths from the measured content: numbers keep their natural width
 * (they must never be cut), text columns share whatever space remains.
 */
function columnWidths(pdf, table, info, width) {
  const sample = table.rows.slice(0, 300);
  const natural = table.columns.map((c) => {
    pdf.font('Helvetica-Bold').fontSize(7.5);
    let w = pdf.widthOfString(c.format === 'money' ? `${c.label} (${info.currency})` : c.label);
    pdf.font('Helvetica').fontSize(8);
    for (const r of sample) w = Math.max(w, pdf.widthOfString(display(r[c.key], c.format, info)));
    return w + 10;
  });
  const total = natural.reduce((sum, w) => sum + w, 0);
  if (total <= width) return natural.map((w) => w * (width / total));
  const numeric = table.columns.map((c) => isNumeric(c.format));
  const fixed = natural.reduce((sum, w, i) => sum + (numeric[i] ? w : 0), 0);
  const flexible = total - fixed;
  const room = width - fixed;
  if (room >= flexible * 0.3 && flexible > 0) return natural.map((w, i) => (numeric[i] ? w : Math.max(36, (w / flexible) * room)));
  return natural.map((w) => w * (width / total));
}

function pdfHeader(pdf, info, width, left) {
  const top = 40;
  const logo = logoPath();
  let textLeft = left;
  if (logo) {
    try {
      pdf.image(logo, left, top, { fit: [44, 44] });
      textLeft = left + 54;
    } catch {
      textLeft = left;
    }
  }
  pdf.fillColor(PDF_BRAND).font('Helvetica-Bold').fontSize(7.5).text(SYSTEM_NAME, textLeft, top, { characterSpacing: 1.4, lineBreak: false });
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(info.business.name, textLeft, top + 12, { width: width / 2, lineBreak: false });
  const contact = [info.business.address, info.business.phone, info.business.email].filter(Boolean).join(' · ');
  pdf.font('Helvetica').fontSize(8).fillColor(MUTED).text(contact, textLeft, top + 31, { width: width / 2 });
  if (info.business.tin) pdf.text(`TIN ${info.business.tin}${info.business.vrn ? ` · VRN ${info.business.vrn}` : ''}`, textLeft, pdf.y + 1, { width: width / 2 });

  const right = left + width / 2;
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(info.title, right, top, { width: width / 2, align: 'right' });
  pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  pdf.text(`Period: ${info.period}`, right, pdf.y + 2, { width: width / 2, align: 'right' });
  if (info.branch) pdf.text(`Branch: ${info.branch}`, right, pdf.y, { width: width / 2, align: 'right' });
  pdf.text(`Generated ${info.generatedAt}${info.generatedBy ? ` by ${info.generatedBy}` : ''}`, right, pdf.y, { width: width / 2, align: 'right' });
  const y = Math.max(pdf.y, top + 60) + 8;
  pdf.moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).strokeColor('#DDDDDD').stroke();
  return y + 12;
}

async function toPdf(doc, info) {
  const wide = doc.tables.some((t) => t.columns.length > 7);
  const pdf = new PDFDocument({ size: 'A4', layout: wide ? 'landscape' : 'portrait', margin: 36, bufferPages: true, info: { Title: `${info.title} — ${SYSTEM_NAME}`, Author: SYSTEM_NAME } });
  const left = 36;
  const width = pdf.page.width - 72;
  const bottom = () => pdf.page.height - 50;
  let y = pdfHeader(pdf, info, width, left);

  // Summary figures in a grid of boxes.
  const perRow = wide ? 5 : 4;
  const boxW = (width - (perRow - 1) * 8) / perRow;
  doc.summary.forEach(([label, value, format], i) => {
    const col = i % perRow;
    if (i && col === 0) y += 44;
    const x = left + col * (boxW + 8);
    pdf.roundedRect(x, y, boxW, 38, 4).fillColor('#FDF1F5').fill();
    pdf.fillColor(MUTED).font('Helvetica').fontSize(7);
    pdf.text(fit(pdf, label.toUpperCase(), boxW - 16), x + 8, y + 7, { lineBreak: false });
    pdf.fillColor(INK).font('Helvetica-Bold').fontSize(11);
    pdf.text(fit(pdf, display(value, format, info), boxW - 16), x + 8, y + 19, { lineBreak: false });
  });
  y += 56;

  for (const table of doc.tables) {
    const widths = columnWidths(pdf, table, info, width);
    const rowH = 16;
    const drawHead = () => {
      pdf.rect(left, y, width, rowH + 2).fillColor(HEAD_FILL).fill();
      let x = left;
      table.columns.forEach((c, i) => {
        pdf.fillColor(INK).font('Helvetica-Bold').fontSize(7.5);
        const label = fit(pdf, c.format === 'money' ? `${c.label} (${info.currency})` : c.label, widths[i] - 8);
        pdf.text(label, x + 4, y + 5, { width: widths[i] - 8, align: isNumeric(c.format) ? 'right' : 'left', lineBreak: false });
        x += widths[i];
      });
      y += rowH + 2;
    };
    if (y + 60 > bottom()) {
      pdf.addPage();
      y = 40;
    }
    pdf.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(table.title, left, y);
    y = pdf.y + 4;
    drawHead();
    if (!table.rows.length) {
      pdf.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8.5).text('No data for this period', left + 4, y + 4);
      y += rowH + 4;
    }
    table.rows.forEach((r, index) => {
      if (y + rowH > bottom()) {
        pdf.addPage();
        y = 40;
        drawHead();
      }
      if (index % 2) pdf.rect(left, y, width, rowH).fillColor(ZEBRA).fill();
      let x = left;
      table.columns.forEach((c, i) => {
        pdf.fillColor(INK).font('Helvetica').fontSize(8);
        pdf.text(fit(pdf, display(r[c.key], c.format, info), widths[i] - 8), x + 4, y + 4, { width: widths[i] - 8, align: isNumeric(c.format) ? 'right' : 'left', lineBreak: false });
        x += widths[i];
      });
      y += rowH;
    });
    y += 16;
  }

  for (const note of doc.notes || []) {
    if (y + 14 > bottom()) {
      pdf.addPage();
      y = 40;
    }
    pdf.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8).text(`Note: ${note}`, left, y, { width });
    y = pdf.y + 2;
  }

  // Footer with page numbers on every page.
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    pdf.switchToPage(range.start + i);
    pdf.page.margins.bottom = 0;
    const fy = pdf.page.height - 30;
    pdf.fillColor(PDF_BRAND).font('Helvetica-Bold').fontSize(7).text(SYSTEM_NAME, left, fy, { width: width / 2, lineBreak: false, characterSpacing: 1 });
    pdf.fillColor(MUTED).font('Helvetica').fontSize(7).text(`${info.title} · Page ${i + 1} of ${range.count}`, left + width / 2, fy, { width: width / 2, align: 'right', lineBreak: false });
  }
  return toBuffer(pdf);
}

// ---- Entry point ------------------------------------------------------------------------------

const FORMATS = {
  pdf: { mime: 'application/pdf', ext: 'pdf', render: toPdf },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', render: toXlsx },
  csv: { mime: 'text/csv; charset=utf-8', ext: 'csv', render: toCsv },
};

async function exportReport(type, title, report, format, ctx) {
  const target = FORMATS[format];
  const info = meta(title, report, ctx);
  const doc = DOCUMENTS[type](report);
  const buffer = await target.render(doc, info);
  const slug = title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { buffer, mime: target.mime, filename: `zola-${slug}-${report.period.from}-to-${report.period.to}.${target.ext}` };
}

module.exports = { exportReport, FORMATS, DOCUMENTS };
