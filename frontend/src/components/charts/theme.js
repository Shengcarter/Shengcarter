import { useThemeStore } from '../../store/themeStore';

/**
 * Chart palette for ZOLA STYLISH MANAGEMENT SYSTEM.
 *
 * Categorical order: gold, blue, orange, violet, magenta, green.
 * Validated with the data-viz palette checks against this app's surfaces
 * (light #FFFFFF, dark #141416): lightness band, chroma floor, adjacent CVD
 * separation (worst ΔE 17.6 light / 13.0 dark, target ≥ 8) and normal-vision
 * floor (≥ 19.7). Gold and magenta are below 3:1 on the light surface, so every
 * chart ships a table view (ChartCard) as the relief channel.
 *
 * Colors are assigned by entity in this fixed order and never cycled; more
 * than six series fold into "Other".
 */
export const SERIES = {
  light: ['#b8952a', '#2a78d6', '#eb6834', '#4a3aa7', '#e87ba4', '#008300'],
  dark: ['#a8841f', '#3987e5', '#d95926', '#9085e9', '#d55181', '#008300'],
};

const CHROME = {
  light: { grid: '#ece7de', axis: '#d6cfc3', tick: '#7a746b', surface: '#ffffff', cursor: '#b5ad9f' },
  dark: { grid: '#26262a', axis: '#34343a', tick: '#8b867e', surface: '#141416', cursor: '#55555c' },
};

export function useChartTheme() {
  const isDark = useThemeStore((s) => s.isDark);
  const mode = isDark ? 'dark' : 'light';
  return { mode, series: SERIES[mode], ...CHROME[mode] };
}

export const MAX_SERIES = SERIES.light.length;
