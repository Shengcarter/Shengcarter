import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useChartTheme } from './theme';

/**
 * Chart primitives following the data-viz method:
 *   lines 2px · markers ≥ 8px with a 2px surface ring · area wash ~10%
 *   bars ≤ 24px thick, 4px rounded data-end, square at the baseline
 *   solid hairline grid, recessive axes, crosshair tooltip on time series
 *   legend only for ≥ 2 series; text never wears the series color.
 */

const axisProps = (theme) => ({
  stroke: theme.axis,
  tick: { fill: theme.tick, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: theme.axis },
});

/** Tooltip: value leads (strong), series name follows; short line keys. */
function TooltipContent({ active, payload, label, formatValue, formatLabel }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-xl border border-line bg-surface px-3 py-2 shadow-xl shadow-black/10">
      <p className="mb-1 text-xs text-muted">{formatLabel ? formatLabel(label) : label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="h-0.5 w-3 rounded-full" style={{ background: p.color || p.payload?.fill }} aria-hidden />
          <span className="text-sm font-semibold text-fg">{formatValue ? formatValue(p.value, p.dataKey) : p.value}</span>
          {payload.length > 1 || p.name ? <span className="text-xs text-muted">{p.name}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function Legend({ series }) {
  if (series.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-muted">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Trend over time. series: [{ key, label }] — colors are assigned by position
 * in this list (stable per entity: callers keep a fixed series order).
 */
export function TimeSeriesChart({ data, xKey = 'date', series, formatValue, formatX, formatLabel, area = true, height = '100%' }) {
  const theme = useChartTheme();
  const colored = series.map((s, i) => ({ ...s, color: s.color || theme.series[i % theme.series.length] }));
  const single = colored.length === 1;
  const Chart = single && area ? AreaChart : LineChart;

  return (
    <div className="flex h-full flex-col">
      <Legend series={colored} />
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height={height}>
          <Chart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.grid} strokeWidth={1} />
            <XAxis dataKey={xKey} {...axisProps(theme)} tickFormatter={formatX} minTickGap={24} />
            <YAxis {...axisProps(theme)} axisLine={false} width={64} tickFormatter={(v) => (formatValue ? formatValue(v, 'axis') : v)} />
            <Tooltip
              cursor={{ stroke: theme.cursor, strokeWidth: 1 }}
              content={<TooltipContent formatValue={formatValue} formatLabel={formatLabel || formatX} />}
            />
            {colored.map((s) =>
              single && area ? (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{ r: 4.5, fill: s.color, stroke: theme.surface, strokeWidth: 2 }}
                />
              ) : (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: 4.5, fill: s.color, stroke: theme.surface, strokeWidth: 2 }}
                />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Vertical columns over a category/time axis (one series, slot-1 color). */
export function ColumnChart({ data, xKey, yKey, label, formatValue, formatX, height = '100%' }) {
  const theme = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
        <CartesianGrid vertical={false} stroke={theme.grid} />
        <XAxis dataKey={xKey} {...axisProps(theme)} tickFormatter={formatX} minTickGap={12} />
        <YAxis {...axisProps(theme)} axisLine={false} width={formatValue ? 64 : 40} allowDecimals={false} tickFormatter={(v) => (formatValue ? formatValue(v, 'axis') : v)} />
        <Tooltip cursor={{ fill: theme.grid, opacity: 0.5 }} content={<TooltipContent formatValue={formatValue} formatLabel={formatX} />} />
        <Bar dataKey={yKey} name={label} fill={theme.series[0]} maxBarSize={24} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Parts of a whole per period, stacked (e.g. where each week's service money
 * went). series: [{ key, label }] in a fixed entity order, colours by position;
 * a 2px surface gap separates the parts; a part below zero (a loss) sits under
 * the baseline. Legend always shown for ≥ 2 series.
 */
export function StackedColumnChart({ data, xKey, series, formatValue, formatX, height = '100%' }) {
  const theme = useChartTheme();
  const colored = series.map((s, i) => ({ ...s, color: s.color || theme.series[i % theme.series.length] }));
  return (
    <div className="flex h-full flex-col">
      <Legend series={colored} />
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey={xKey} {...axisProps(theme)} tickFormatter={formatX} minTickGap={12} />
            <YAxis {...axisProps(theme)} axisLine={false} width={64} tickFormatter={(v) => (formatValue ? formatValue(v, 'axis') : v)} />
            <Tooltip cursor={{ fill: theme.grid, opacity: 0.5 }} content={<TooltipContent formatValue={formatValue} formatLabel={formatX} />} />
            {colored.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="parts"
                fill={s.color}
                stroke={theme.surface}
                strokeWidth={2}
                maxBarSize={28}
                radius={i === colored.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Ranked horizontal bars (compare magnitude across nominal categories).
 * One series → one color; value label at the bar tip.
 */
export function RankedBarChart({ data, nameKey = 'name', valueKey = 'value', label, formatValue, height = '100%', colorByIndex = false }) {
  const theme = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 0 }} barCategoryGap="28%">
        <CartesianGrid horizontal={false} stroke={theme.grid} />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey={nameKey} {...axisProps(theme)} axisLine={false} width={120} interval={0} />
        <Tooltip cursor={{ fill: theme.grid, opacity: 0.5 }} content={<TooltipContent formatValue={formatValue} />} />
        <Bar dataKey={valueKey} name={label} fill={theme.series[0]} maxBarSize={24} radius={[0, 4, 4, 0]}>
          {colorByIndex ? data.map((_, i) => <Cell key={i} fill={theme.series[i % theme.series.length]} />) : null}
          <LabelList dataKey={valueKey} position="right" formatter={(v) => (formatValue ? formatValue(v) : v)} style={{ fill: theme.tick, fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Part-to-whole as a single stacked horizontal bar with a legend (instead of
 * a pie). segments: [{ key, label, value }] in a fixed entity order.
 */
export function ShareBar({ segments, formatValue }) {
  const theme = useChartTheme();
  const total = segments.reduce((sum, s) => sum + Number(s.value || 0), 0);
  const colored = segments.map((s, i) => ({ ...s, color: s.color || theme.series[i % theme.series.length] }));
  return (
    <div>
      <div className="flex h-6 w-full gap-0.5 overflow-hidden rounded-md" role="img" aria-label="Share breakdown">
        {colored.filter((s) => s.value > 0).map((s) => (
          <div
            key={s.key}
            className="h-full first:rounded-l-md last:rounded-r-md"
            style={{ width: `${(s.value / (total || 1)) * 100}%`, background: s.color }}
            title={`${s.label}: ${formatValue ? formatValue(s.value) : s.value}`}
          />
        ))}
      </div>
      <ul className="mt-4 space-y-2.5">
        {colored.map((s) => (
          <li key={s.key} className="flex items-center gap-3 text-sm">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="flex-1 text-muted">{s.label}</span>
            <span className="font-medium text-fg">{formatValue ? formatValue(s.value) : s.value}</span>
            <span className="w-12 text-right text-xs text-muted tabular-nums">{total ? `${((s.value / total) * 100).toFixed(0)}%` : '0%'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
