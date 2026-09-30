import { useAuthStore } from '../../store/authStore';

/**
 * The service money split in force (Settings → Financial):
 * price − products used → operations % → staff % / salon profit % of the rest.
 */
export function useSplitRules() {
  const financial = useAuthStore((s) => s.settings?.financial) || {};
  const operations = Number(financial.operations_percentage ?? 30);
  const staff = Number(financial.staff_pool_percentage ?? 50);
  const profit = Number(financial.salon_profit_percentage ?? 50);
  const left = 100 - operations;
  return {
    operations,
    staff,
    profit,
    // Share of what is left after products, e.g. 35% with 30 / 50 / 50.
    staffOfMargin: Math.round(left * staff) / 100,
    profitOfMargin: Math.round(left * profit) / 100,
  };
}

export const SPLIT_KEYS = ['productCost', 'operations', 'staffPool', 'salonProfit'];
