import { formatMoney } from '../../utils/format';

/**
 * One-line description of a service's financial rule (from the catalog's
 * `financialRule` summary), e.g. "Fixed amounts at 10,000 · 15,000".
 */
export function describeRule(rule) {
  if (!rule) return 'General formula';
  if (rule.method === 'general') return 'General formula';
  if (rule.method === 'unconfigured') return 'Financial rule not set';
  if (rule.priceOptions?.length) return `Fixed amounts at ${rule.priceOptions.map((p) => formatMoney(p)).join(' · ')}`;
  return `Price bands: ${rule.bands.map((b) => b.label).join(' · ')}`;
}

/** Badge tone for a rule: not set is a warning, everything else neutral. */
export const ruleTone = (rule) => (rule?.method === 'unconfigured' ? 'warning' : rule?.method === 'bands' ? 'brand' : 'neutral');
