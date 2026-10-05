'use strict';

const { sendSuccess, sendCreated, sendPaginated } = require('../utils/response');
const salesService = require('../services/salesService');
const serviceFinance = require('../services/serviceFinanceService');
const documentService = require('../services/documentService');

async function create(req, res) {
  const sale = await salesService.createSale(req.body, req.ctx);
  sendCreated(res, sale, sale.isBackdated ? `Sale recorded for a previous date — ${sale.invoiceNumber}` : `Sale completed — ${sale.invoiceNumber}`);
}

async function quote(req, res) {
  sendSuccess(res, await salesService.quote(req.body, req.ctx));
}

async function list(req, res) {
  sendPaginated(res, await salesService.list(req.validQuery, req.ctx));
}

async function get(req, res) {
  sendSuccess(res, await salesService.getById(req.params.id, req.ctx));
}

async function recordPayment(req, res) {
  const result = await salesService.recordPayment(req.params.id, req.body, req.ctx);
  sendSuccess(res, result, result.changeGiven > 0 ? `Payment recorded. Give change: ${result.changeGiven}` : 'Payment recorded');
}

async function refund(req, res) {
  sendSuccess(res, await salesService.refundSale(req.params.id, req.body, req.ctx), 'Sale refunded');
}

/** Void (delete) a sale recorded by mistake: everything it did is undone, the record stays. */
async function voidSale(req, res) {
  sendSuccess(res, await salesService.voidSale(req.params.id, req.body, req.ctx), 'Sale voided');
}

/** Move a sale to its correct business date. */
async function changeDate(req, res) {
  sendSuccess(res, await salesService.changeSaleDate(req.params.id, req.body, req.ctx), 'Sale date changed');
}

/** Correct a completed service's products used, price or staff (recalculated, with an audit trail). */
async function correctService(req, res) {
  await serviceFinance.correct(req.params.id, req.params.itemId, req.body, req.ctx);
  sendSuccess(res, await salesService.getById(req.params.id, req.ctx), 'Service corrected and recalculated');
}

/** Mark a zero or negative margin service as reviewed. */
async function reviewService(req, res) {
  await serviceFinance.review(req.params.id, req.params.itemId, req.body, req.ctx);
  sendSuccess(res, await salesService.getById(req.params.id, req.ctx), 'Marked as reviewed');
}

/** PDF invoice (A4) or receipt (80 mm thermal). */
async function document(req, res) {
  const sale = await salesService.getById(req.params.id, req.ctx);
  const format = req.validQuery?.format || 'a4';
  const buffer = format === 'thermal' ? await documentService.receiptPdf(sale) : await documentService.invoicePdf(sale);
  const name = format === 'thermal' ? `receipt-${sale.receiptNumber}` : `invoice-${sale.invoiceNumber}`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.validQuery?.download ? 'attachment' : 'inline'}; filename="${name}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}

async function appointmentCheckout(req, res) {
  sendSuccess(res, await salesService.appointmentCheckout(req.params.id, req.ctx));
}

async function payments(req, res) {
  sendPaginated(res, await salesService.listPayments(req.validQuery, req.ctx));
}

module.exports = { create, quote, list, get, recordPayment, refund, voidSale, changeDate, correctService, reviewService, document, appointmentCheckout, payments };
