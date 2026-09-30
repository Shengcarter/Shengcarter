-- WhatsApp appointment confirmations with customer replies, and a thank-you
-- message after payment.

-- The customer's latest reply to a confirmation or reminder: "YES" confirms,
-- "LATE 15" records a delay, "CANCEL" asks the salon to call back.
ALTER TABLE appointments
  ADD COLUMN customer_response ENUM('confirmed','late','cancel_request','message') NULL COMMENT 'Latest reply from the customer' AFTER reminder_sent_at,
  ADD COLUMN customer_response_at DATETIME NULL AFTER customer_response,
  ADD COLUMN customer_delay_minutes SMALLINT UNSIGNED NULL COMMENT 'Minutes late, when the customer said so' AFTER customer_response_at,
  ADD COLUMN customer_response_note VARCHAR(500) NULL COMMENT 'The reply as the customer wrote it' AFTER customer_delay_minutes;

-- Incoming WhatsApp messages are kept in the message log next to the ones we
-- send. template_params holds the values for an approved WhatsApp template,
-- which WhatsApp requires for messages the salon starts.
ALTER TABLE message_logs
  ADD COLUMN direction ENUM('outbound','inbound') NOT NULL DEFAULT 'outbound' AFTER channel,
  MODIFY COLUMN status ENUM('queued','sent','failed','skipped','received') NOT NULL DEFAULT 'queued',
  ADD COLUMN template_params JSON NULL COMMENT 'Values for an approved WhatsApp template, in order' AFTER template,
  ADD KEY idx_message_logs_provider_ref (provider_ref);

-- Customer messages go by WhatsApp. Only events still on the original
-- defaults are switched, so a salon's own choices are kept.
UPDATE settings SET setting_value = JSON_SET(setting_value, '$.appointment_confirmation', JSON_ARRAY('whatsapp'))
WHERE setting_key = 'notifications.channels' AND JSON_EXTRACT(setting_value, '$.appointment_confirmation') = JSON_ARRAY('sms');
UPDATE settings SET setting_value = JSON_SET(setting_value, '$.appointment_reminder', JSON_ARRAY('whatsapp'))
WHERE setting_key = 'notifications.channels' AND JSON_EXTRACT(setting_value, '$.appointment_reminder') = JSON_ARRAY('sms');
UPDATE settings SET setting_value = JSON_SET(setting_value, '$.appointment_cancelled', JSON_ARRAY('whatsapp'))
WHERE setting_key = 'notifications.channels' AND JSON_EXTRACT(setting_value, '$.appointment_cancelled') = JSON_ARRAY('sms');
UPDATE settings SET setting_value = JSON_SET(setting_value, '$.payment_receipt', JSON_ARRAY('whatsapp'))
WHERE setting_key = 'notifications.channels' AND JSON_EXTRACT(setting_value, '$.payment_receipt') = JSON_ARRAY();

-- New wording (again only where the original text was never edited).
UPDATE settings SET setting_value = JSON_SET(setting_value, '$.appointment_confirmation',
  'Hello {{customer_name}}, your appointment at {{salon_name}} is booked for {{date}} at {{time}} with {{stylist}} ({{services}}). Please reply YES to confirm. If you will be late, reply LATE and the minutes, e.g. LATE 15. Ref: {{code}}.')
WHERE setting_key = 'notifications.templates'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.appointment_confirmation')) = 'Hello {{customer_name}}, your appointment at {{salon_name}} is booked for {{date}} at {{time}} with {{stylist}}. Ref: {{code}}.';
UPDATE settings SET setting_value = JSON_SET(setting_value, '$.appointment_reminder',
  'Hello {{customer_name}}, a reminder of your appointment at {{salon_name}} on {{date}} at {{time}} with {{stylist}}. Please reply YES to confirm, or LATE and the minutes if you will be delayed, e.g. LATE 15. Ref: {{code}}.')
WHERE setting_key = 'notifications.templates'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.appointment_reminder')) = 'Reminder: {{customer_name}}, we look forward to seeing you at {{salon_name}} on {{date}} at {{time}}. Ref: {{code}}.';
UPDATE settings SET setting_value = JSON_SET(setting_value, '$.payment_receipt',
  'Thank you for choosing {{salon_name}}, {{customer_name}}! We have received your payment of {{amount}} for invoice {{invoice_number}}. It was a pleasure serving you, and we look forward to welcoming you again soon.')
WHERE setting_key = 'notifications.templates'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.payment_receipt')) = 'Thank you {{customer_name}}! We received {{amount}} for invoice {{invoice_number}} at {{salon_name}}.';

-- Automatic answers to the customer's reply (JSON_INSERT keeps existing text).
UPDATE settings SET setting_value = JSON_INSERT(setting_value,
  '$.reply_confirmed', 'Thank you, {{customer_name}}! Your appointment on {{date}} at {{time}} is confirmed. See you soon at {{salon_name}}.',
  '$.reply_late', 'Thank you for letting us know, {{customer_name}}. We have told {{stylist}} that you will be {{delay}}. See you soon!',
  '$.reply_received', 'Thank you, {{customer_name}}. We have received your message about your appointment on {{date}} at {{time}}, and our team will contact you shortly.')
WHERE setting_key = 'notifications.templates';
