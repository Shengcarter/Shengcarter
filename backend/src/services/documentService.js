'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('../config');
const settings = require('./settingsService');
const { formatMoney, formatNumber, formatDateTime, titleCase } = require('../utils/format');
const { sum, toNumber } = require('../utils/money');

/**
 * PDF documents: A4 invoices and 80 mm thermal receipts.
 * Every document carries the official system name.
 */
const SYSTEM_NAME = config.appName;
// Rose-pink theme: deep pink (AA on white) for accents, navy for text.
const BRAND = '#C20E57';
const INK = '#191A2E';
const MUTED = '#666666';

function logoPath() {
  const logo = settings.get('business.logo');
  if (!logo || !/\.(png|jpe?g)$/i.test(logo)) return null; // PDFKit supports PNG and JPEG
  const file = path.resolve(config.paths.uploads, logo.replace(/^\/uploads\//, ''));
  return file.startsWith(path.resolve(config.paths.uploads)) && fs.existsSync(file) ? file : null;
}

function business() {
  return {
    name: settings.get('business.salon_name'),
    phone: settings.get('business.phone'),
    email: settings.get('business.email'),
    address: settings.get('business.address'),
    website: settings.get('business.website'),
    tin: settings.get('business.tax_number'),
    vrn: settings.get('business.vat_number'),
    taxLabel: settings.get('financial.tax_label') || 'Tax',
    footer: settings.get('financial.receipt_footer'),
  };
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function paymentSummary(sale) {
  return sale.payments.filter((p) => p.type === 'payment').map((p) => `${titleCase(p.method)} ${formatMoney(p.amount)}`).join(', ') || '—';
}

// ---- A4 invoice ---------------------------------------------------------------------

function invoicePdf(sale) {
  const b = business();
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${sale.invoiceNumber}`, Author: SYSTEM_NAME } });
  const width = doc.page.width - 96;

  // Header
  const logo = logoPath();
  if (logo) doc.image(logo, 48, 44, { fit: [56, 56] });
  const left = logo ? 116 : 48;
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(8).text(SYSTEM_NAME, left, 48, { characterSpacing: 1.5 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(b.name, left, 62);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  const contact = [sale.branchName, b.address, b.phone, b.email, b.website].filter(Boolean).join(' · ');
  doc.text(contact, left, 86, { width: 300 });
  if (b.tin || b.vrn) doc.text([b.tin ? `TIN: ${b.tin}` : null, b.vrn ? `VRN: ${b.vrn}` : null].filter(Boolean).join('   '), left, doc.y + 2);

  doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(sale.status === 'refunded' ? 'REFUNDED' : 'INVOICE', 48, 48, { width, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  doc.text(`Invoice no. ${sale.invoiceNumber}`, 48, 76, { width, align: 'right' });
  doc.text(`Receipt no. ${sale.receiptNumber}`, { width, align: 'right' });
  doc.text(`Date: ${formatDateTime(sale.soldAt)}`, { width, align: 'right' });
  if (sale.appointmentCode) doc.text(`Appointment: ${sale.appointmentCode}`, { width, align: 'right' });

  // Bill to
  const y0 = 150;
  doc.moveTo(48, y0).lineTo(48 + width, y0).lineWidth(0.5).strokeColor('#DDDDDD').stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('BILLED TO', 48, y0 + 12);
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(sale.customerName || 'Walk-in customer', 48, y0 + 24);
  if (sale.customerPhone) doc.fontSize(9).fillColor(MUTED).text(`${sale.customerPhone}${sale.customerCode ? ` · ${sale.customerCode}` : ''}`);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('SERVED BY', 320, y0 + 12);
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(sale.cashierName, 320, y0 + 24);

  // Items table
  let y = y0 + 64;
  const cols = [
    { label: 'Item', x: 48, w: 210 },
    { label: 'Staff', x: 262, w: 100 },
    { label: 'Qty', x: 366, w: 36, align: 'right' },
    { label: 'Price', x: 406, w: 70, align: 'right' },
    { label: 'Amount', x: 480, w: width + 48 - 480, align: 'right' },
  ];
  doc.rect(48, y - 6, width, 22).fill('#FCEFF4');
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5);
  cols.forEach((c) => doc.text(c.label.toUpperCase(), c.x + 4, y, { width: c.w - 8, align: c.align || 'left' }));
  y += 24;
  doc.font('Helvetica').fontSize(9.5);
  for (const item of sale.items) {
    const rowHeight = Math.max(18, doc.heightOfString(item.description, { width: cols[0].w - 8 }) + 6);
    if (y + rowHeight > doc.page.height - 200) {
      doc.addPage();
      y = 60;
    }
    doc.fillColor(INK).text(item.description, cols[0].x + 4, y, { width: cols[0].w - 8 });
    doc.fillColor(MUTED).text(item.employeeName || '—', cols[1].x + 4, y, { width: cols[1].w - 8 });
    doc.fillColor(INK).text(String(item.quantity), cols[2].x + 4, y, { width: cols[2].w - 8, align: 'right' });
    doc.text(formatMoney(item.unitPrice), cols[3].x + 4, y, { width: cols[3].w - 8, align: 'right' });
    doc.text(formatMoney(item.lineTotal), cols[4].x + 4, y, { width: cols[4].w - 8, align: 'right' });
    y += rowHeight;
    doc.moveTo(48, y - 3).lineTo(48 + width, y - 3).lineWidth(0.3).strokeColor('#EEEEEE').stroke();
  }

  // Totals
  y += 10;
  const totals = [
    ['Subtotal', formatMoney(sale.subtotal)],
    ...(sale.discountAmount > 0 ? [[`Discount${sale.discountType === 'percentage' ? ` (${formatNumber(sale.discountValue, 2)}%)` : ''}`, `- ${formatMoney(sale.discountAmount)}`]] : []),
    ...(sale.loyaltyDiscount > 0 ? [[`Loyalty (${sale.loyaltyPointsRedeemed} pts)`, `- ${formatMoney(sale.loyaltyDiscount)}`]] : []),
    ...(sale.taxMode !== 'none' && sale.taxRate > 0 ? [[`${b.taxLabel} ${formatNumber(sale.taxRate, 2)}%${sale.taxMode === 'inclusive' ? ' (included)' : ''}`, formatMoney(sale.taxAmount)]] : []),
  ];
  doc.fontSize(9.5);
  for (const [label, value] of totals) {
    doc.fillColor(MUTED).text(label, 330, y, { width: 140 });
    doc.fillColor(INK).text(value, 470, y, { width: width + 48 - 470, align: 'right' });
    y += 16;
  }
  doc.rect(330, y, width + 48 - 330, 26).fill('#141A2E');
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11).text('TOTAL', 338, y + 8);
  doc.fillColor('#FF6FA8').text(formatMoney(sale.total), 470, y + 8, { width: width + 48 - 478, align: 'right' });
  y += 36;
  doc.font('Helvetica').fontSize(9.5);
  for (const [label, value] of [
    ['Amount paid', formatMoney(sale.amountPaid)],
    ...(sale.changeDue > 0 ? [['Tendered', formatMoney(toNumber(sum([sale.amountPaid, sale.changeDue])))], ['Change', formatMoney(sale.changeDue)]] : []),
    ['Balance due', formatMoney(sale.balanceDue)],
  ]) {
    doc.fillColor(MUTED).text(label, 330, y, { width: 140 });
    doc.fillColor(INK).text(value, 470, y, { width: width + 48 - 470, align: 'right' });
    y += 16;
  }

  doc.fillColor(MUTED).fontSize(9).text(`Payment method: ${paymentSummary(sale)}`, 48, y - 48, { width: 260 });
  if (sale.status === 'refunded') doc.fillColor('#B91C1C').text(`Refunded ${formatDateTime(sale.refundedAt)}: ${sale.refundReason || ''}`, 48, doc.y + 6, { width: 260 });

  // Footer — drawn inside the bottom margin, so it never triggers a new page.
  const footerY = doc.page.height - 90;
  doc.page.margins.bottom = 0;
  doc.moveTo(48, footerY).lineTo(48 + width, footerY).lineWidth(0.5).strokeColor('#DDDDDD').stroke();
  if (b.footer) doc.fillColor(INK).font('Helvetica').fontSize(9).text(b.footer, 48, footerY + 10, { width, align: 'center', lineBreak: true });
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(7.5).text(SYSTEM_NAME, 48, footerY + 36, { width, align: 'center', characterSpacing: 1.2, lineBreak: false });
  return toBuffer(doc);
}

// ---- 80 mm thermal receipt ---------------------------------------------------------------

const RECEIPT_WIDTH = 226.77; // 80 mm roll
const RECEIPT_MARGIN = 10;

/**
 * Thermal receipt. Rendered twice: once on a tall page to measure the
 * content, then on a page exactly that tall so no paper is wasted.
 */
async function receiptPdf(sale) {
  const measure = new PDFDocument({ size: [RECEIPT_WIDTH, 5000], margins: { top: 12, bottom: 12, left: RECEIPT_MARGIN, right: RECEIPT_MARGIN } });
  drawReceipt(measure, sale);
  const height = Math.ceil(measure.y + 16);
  measure.end();
  const doc = new PDFDocument({ size: [RECEIPT_WIDTH, height], margins: { top: 12, bottom: 0, left: RECEIPT_MARGIN, right: RECEIPT_MARGIN }, info: { Title: `Receipt ${sale.receiptNumber}`, Author: SYSTEM_NAME } });
  drawReceipt(doc, sale);
  return toBuffer(doc);
}

function drawReceipt(doc, sale) {
  const b = business();
  const pageWidth = RECEIPT_WIDTH;
  const margin = RECEIPT_MARGIN;
  const w = pageWidth - margin * 2;

  const center = (text, opts = {}) => doc.text(text, margin, doc.y, { width: w, align: 'center', ...opts });
  const row = (label, value, bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, margin, y, { width: w * 0.55 });
    doc.text(value, margin + w * 0.45, y, { width: w * 0.55, align: 'right' });
    doc.moveDown(0.15);
  };
  const rule = () => {
    doc.moveDown(0.3);
    doc.moveTo(margin, doc.y).lineTo(margin + w, doc.y).dash(2, { space: 2 }).lineWidth(0.5).strokeColor('#000000').stroke().undash();
    doc.moveDown(0.4);
  };

  const logo = logoPath();
  if (logo) {
    doc.image(logo, (pageWidth - 44) / 2, doc.y, { fit: [44, 44] });
    doc.moveDown(3.4);
  }
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(6.5);
  center(SYSTEM_NAME, { characterSpacing: 0.6 });
  doc.fontSize(11).moveDown(0.2);
  center(b.name);
  doc.font('Helvetica').fontSize(7.5);
  [sale.branchName, b.address, b.phone].filter(Boolean).forEach((line) => center(line));
  if (b.tin) center(`TIN: ${b.tin}${b.vrn ? `  VRN: ${b.vrn}` : ''}`);
  rule();

  doc.fontSize(7.5);
  row('Receipt', sale.receiptNumber);
  row('Invoice', sale.invoiceNumber);
  row('Date', formatDateTime(sale.soldAt));
  row('Customer', sale.customerName || 'Walk-in');
  row('Cashier', sale.cashierName);
  rule();

  for (const item of sale.items) {
    doc.font('Helvetica-Bold').fontSize(7.5).text(item.description, margin, doc.y, { width: w });
    const detail = `${item.quantity} × ${formatMoney(item.unitPrice)}${item.employeeName ? `  (${item.employeeName.split(' ')[0]})` : ''}`;
    row(detail, formatMoney(item.lineTotal));
  }
  rule();

  doc.fontSize(8);
  row('Subtotal', formatMoney(sale.subtotal));
  if (sale.discountAmount > 0) row('Discount', `-${formatMoney(sale.discountAmount)}`);
  if (sale.loyaltyDiscount > 0) row(`Loyalty (${sale.loyaltyPointsRedeemed} pts)`, `-${formatMoney(sale.loyaltyDiscount)}`);
  if (sale.taxMode !== 'none' && sale.taxRate > 0) row(`${b.taxLabel} ${formatNumber(sale.taxRate, 2)}%${sale.taxMode === 'inclusive' ? ' incl.' : ''}`, formatMoney(sale.taxAmount));
  doc.fontSize(10);
  row('TOTAL', formatMoney(sale.total), true);
  doc.fontSize(8);
  for (const p of sale.payments.filter((x) => x.type === 'payment')) row(titleCase(p.method), formatMoney(p.amount));
  if (sale.changeDue > 0) {
    row('Tendered', formatMoney(toNumber(sum([sale.amountPaid, sale.changeDue]))));
    row('Change', formatMoney(sale.changeDue));
  }
  if (sale.balanceDue > 0) row('Balance due', formatMoney(sale.balanceDue), true);
  if (sale.loyaltyPointsEarned) row('Points earned', String(sale.loyaltyPointsEarned));
  if (sale.status === 'refunded') {
    rule();
    doc.font('Helvetica-Bold');
    center('*** REFUNDED ***');
  }
  rule();
  doc.font('Helvetica').fontSize(7.5);
  if (b.footer) center(b.footer);
  doc.moveDown(0.5);
  doc.fontSize(6.5).fillColor('#444');
  center(`Powered by ${SYSTEM_NAME}`);
}

module.exports = { invoicePdf, receiptPdf, business, logoPath, toBuffer, SYSTEM_NAME };
