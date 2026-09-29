import { useThemeStore } from '../../store/themeStore';

/**
 * Chart palette for ZOLA STYLISH MANAGEMENT SYSTEM (rose-pink theme).
 *
 * Categorical order: pink, blue, green, purple, orange, teal.
 * Chosen by enumerating every order of these hues (pink fixed first as the
 * brand colour) and keeping the one with the widest separation between
 * neighbours. Validated with the data-viz palette checks against this app's
 * chart surfaces (light #FFFFFF, dark #141A2E): lightness band, chroma floor,
 * adjacent CVD separation (worst ΔE 17.4 light / 18.3 dark, target ≥ 8),
 * normal-vision floor (≥ 20.9) and contrast (every slot ≥ 3:1 in both modes).
 * Every chart still ships a table view (ChartCard).
 *
 * Colors are assigned by entity in this fixed order and never cycled; more
 * than six series fold into "Other".
 */
export const SERIES = {
  light: ['#e3166a', '#0195ea', '#01a363', '#8612b2', '#d96a00', '#009aa6'],
  dark: ['#e3166a', '#2f9bea', '#1fae6e', '#a45be0', '#d2700a', '#17a5ae'],
};

const CHROME = {
  light: { grid: '#f3e6ec', axis: '#e6d3dc', tick: '#6e7286', surface: '#ffffff', cursor: '#d9bfcb' },
  dark: { grid: '#232b45', axis: '#313a56', tick: '#9ea3b8', surface: '#141a2e', cursor: '#4a5373' },
};

export function useChartTheme() {
  const isDark = useThemeStore((s) => s.isDark);
  const mode = isDark ? 'dark' : 'light';
  return { mode, series: SERIES[mode], ...CHROME[mode] };
}

export const MAX_SERIES = SERIES.light.length;
