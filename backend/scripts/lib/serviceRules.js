'use strict';

const { normalizeRule, validateRule } = require('../../src/services/financialRules');
const { PRESETS, MIGRATED_NOTE } = require('../../src/services/servicePresets');

/**
 * Make sure every service has an explicit financial rule (run by the seed on
 * every setup, so it is safe to repeat):
 *   • the confirmed services (Kufumua, Steaming, Relaxer, Kubana Nyuele) are
 *     created if missing, or given their rule if theirs was never configured
 *     by hand (an existing Kubana Nyuele keeps its price and settings, but is
 *     marked "not configured" rather than left on the general formula);
 *   • any other service without a rule gets the general formula.
 * Uses the script's own connection (conn.query returns [rows]).
 */
async function ensureServiceRules(conn) {
  const query = async (sql, params) => (await conn.query(sql, params))[0];

  async function setRule(serviceId, config, notes) {
    const [{ next }] = await query('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM service_financial_rules WHERE service_id = ?', [serviceId]);
    const rule = normalizeRule(config);
    const result = await query(
      'INSERT INTO service_financial_rules (service_id, version, method, config, notes) VALUES (?, ?, ?, ?, ?)',
      [serviceId, next, rule.method, JSON.stringify(rule), notes],
    );
    await query('UPDATE services SET financial_rule_id = ? WHERE id = ?', [result.insertId, serviceId]);
  }

  for (const preset of PRESETS) {
    const problems = validateRule(preset.rule);
    if (problems.length) throw new Error(`Preset rule for ${preset.name} is invalid: ${problems[0].message}`);
    const [existing] = await query(
      `SELECT s.id, r.id AS rule_id, r.notes FROM services s LEFT JOIN service_financial_rules r ON r.id = s.financial_rule_id WHERE s.name = ?`,
      [preset.name],
    );
    if (!existing) {
      const [category] = await query('SELECT id FROM service_categories WHERE slug = ?', [preset.category]);
      const fallback = category || (await query('SELECT id FROM service_categories ORDER BY sort_order, id LIMIT 1'))[0];
      if (!fallback) continue; // no categories yet (reference data not loaded)
      const created = await query(
        'INSERT INTO services (category_id, name, description, price, max_price, duration_minutes, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [fallback.id, preset.name, preset.description, preset.price, preset.maxPrice, preset.duration, preset.active ? 1 : 0],
      );
      await setRule(created.insertId, preset.rule, `Confirmed rule for ${preset.name}`);
      continue;
    }
    // Only replace a rule that was set automatically, never one configured by hand.
    if (!existing.rule_id || existing.notes === MIGRATED_NOTE) {
      if (!preset.keepExisting) {
        await query('UPDATE services SET price = ?, max_price = ? WHERE id = ?', [preset.price, preset.maxPrice, existing.id]);
      }
      await setRule(existing.id, preset.rule, `Confirmed rule for ${preset.name}`);
    }
  }

  // Everything else keeps (or gets) the general formula, explicitly.
  const missing = await query('SELECT id FROM services WHERE financial_rule_id IS NULL');
  for (const { id } of missing) {
    await setRule(id, { method: 'general' }, MIGRATED_NOTE);
  }
}

module.exports = { ensureServiceRules };
