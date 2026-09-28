'use strict';

const { sendSuccess, sendCreated, sendPaginated } = require('../utils/response');
const salesService = require('../services/salesService');
const documentService = require('../services/documentService');

async function create(req, res) {
  const sale = await salesService.createSale(req.body, req.ctx);
  sendCreated(res, sale, `Sale completed — ${sale.invoiceNumber}`);
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

module.exports = { create, quote, list, get, recordPayment, refund, document, appointmentCheckout, payments };
