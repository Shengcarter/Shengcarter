'use strict';

const nodemailer = require('nodemailer');
const config = require('../../../config');
const logger = require('../../../config/logger');
const settings = require('../../settingsService');

/**
 * Email providers:
 *   log  — writes the message to the server log (default; works offline)
 *   smtp — any SMTP server (Gmail, Office 365, Zoho, cPanel mail, ...)
 */
let cachedTransport = null;
let cachedKey = null;

function smtpOptions() {
  return {
    host: settings.get('integrations.smtp_host') || config.integrations.smtp.host,
    port: Number(settings.get('integrations.smtp_port') || config.integrations.smtp.port || 587),
    secure: Boolean(settings.get('integrations.smtp_secure') || config.integrations.smtp.secure),
    user: settings.get('integrations.smtp_user') || config.integrations.smtp.user,
    pass: settings.getSecret('integrations.smtp_password'),
  };
}

function transport() {
  const opts = smtpOptions();
  if (!opts.host) throw new Error('SMTP host is not configured');
  const key = JSON.stringify(opts);
  if (cachedTransport && cachedKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure,
    auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  cachedKey = key;
  return cachedTransport;
}

function fromAddress() {
  const name = settings.get('integrations.email_from_name') || settings.get('business.salon_name');
  const address = settings.get('integrations.email_from_address') || config.integrations.smtp.from || smtpOptions().user;
  return address ? `"${name}" <${address}>` : undefined;
}

async function send({ to, subject, body, html }) {
  const provider = settings.get('integrations.email_provider');
  if (provider === 'smtp') {
    const info = await transport().sendMail({ from: fromAddress(), to, subject, text: body, html });
    return { provider, providerRef: info.messageId };
  }
  logger.info({ channel: 'email', to, subject, body }, 'Email (log provider — not sent)');
  return { provider: 'log', providerRef: null };
}

function isConfigured() {
  const provider = settings.get('integrations.email_provider');
  return provider === 'smtp' ? Boolean(smtpOptions().host) : false;
}

module.exports = { send, isConfigured };
