import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, Bot, CircleAlert, Lightbulb, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { formatDateTime, formatMoney } from '../../utils/format';
import { cn } from '../../utils/cn';
import { reportsApi, useInsights } from './api';
import { percent } from './components';

const SEVERITY = {
  critical: { label: 'Act now', icon: CircleAlert, tone: 'danger', ring: 'text-danger bg-red-500/10 ring-red-500/20' },
  warning: { label: 'Needs attention', icon: AlertTriangle, tone: 'warning', ring: 'text-warning bg-amber-500/10 ring-amber-500/20' },
  positive: { label: 'Going well', icon: TrendingUp, tone: 'success', ring: 'text-success bg-green-500/10 ring-green-500/20' },
  info: { label: 'Worth knowing', icon: Lightbulb, tone: 'gold', ring: 'text-accent bg-gold-500/10 ring-gold-500/20' },
};
const PRIORITY_TONE = { high: 'danger', medium: 'warning', low: 'neutral' };

function Finding({ finding }) {
  const style = SEVERITY[finding.severity] || SEVERITY.info;
  return (
    <li className="flex gap-4 px-5 py-4">
      <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ring-1', style.ring)}>
        <style.icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{finding.title}</p>
          {finding.kind === 'opportunity' ? <Badge tone="gold">Opportunity</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted">{finding.detail}</p>
        {finding.action ? (
          <Link to={finding.action.to} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            {finding.action.label} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export function InsightsPanel({ params }) {
  const qc = useQueryClient();
  const query = useInsights({ from: params.from, to: params.to });
  const [refreshing, setRefreshing] = useState(false);

  if (query.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40" />
        <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  const data = query.data;
  const ai = data.source !== 'rules';

  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await reportsApi.refreshInsights({ from: params.from, to: params.to });
      qc.setQueryData(['insights', Object.fromEntries(Object.entries({ from: params.from, to: params.to }).filter(([, v]) => v))], fresh);
      toast.success('Insights refreshed');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRefreshing(false);
    }
  };

  const groups = ['critical', 'warning', 'positive', 'info']
    .map((severity) => ({ severity, items: data.findings.filter((f) => f.severity === severity) }))
    .filter((g) => g.items.length);
  const h = data.highlights;

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-gold-500/12 via-transparent to-transparent p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-gold-500/15 text-accent ring-1 ring-gold-500/25">
                {ai ? <Bot className="size-5" aria-hidden /> : <Sparkles className="size-5" aria-hidden />}
              </span>
              <div>
                <h2 className="font-semibold">Summary</h2>
                <p className="text-xs text-muted">
                  {data.period.from} to {data.period.to} · {ai ? `Written by AI (${data.ai.model || 'Claude'})` : 'Built-in analysis'} · {formatDateTime(data.generatedAt)}
                </p>
              </div>
            </div>
            {data.ai.configured ? <Button size="sm" variant="secondary" icon={RefreshCw} loading={refreshing} onClick={refresh}>Refresh</Button> : null}
          </div>
          <p className="mt-4 max-w-4xl text-[15px] leading-relaxed">{data.summary}</p>
          {data.ai.error ? <p className="mt-3 text-xs text-warning">{data.ai.error}</p> : null}
          {!data.ai.configured ? (
            <p className="mt-3 text-xs text-muted">Tip: set AI_PROVIDER and AI_API_KEY on the server to add an AI-written summary. Only totals and trends are shared — never customer details.</p>
          ) : null}
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Gross sales', formatMoney(h.gross)],
              ['Change', h.change === null ? '—' : `${h.change > 0 ? '+' : ''}${percent(h.change)}`],
              ['Average sale', formatMoney(h.averageSale)],
              ['Retention', percent(h.retention)],
              ['Cancelled / no-show', percent(h.cancellationRate)],
              ['Utilisation', percent(h.utilization)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface/70 px-3 py-2.5 ring-1 ring-line">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-0.5 font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader title="Findings" description={`${data.findings.length} findings from sales, bookings, staff, stock and expenses`} icon={Sparkles} />
          {groups.length ? (
            groups.map((g) => (
              <section key={g.severity} aria-label={SEVERITY[g.severity].label} className="border-t border-line">
                <h3 className="px-5 pt-4 text-xs font-semibold tracking-wide text-muted uppercase">{SEVERITY[g.severity].label}</h3>
                <ul className="divide-y divide-line/60">{g.items.map((f) => <Finding key={f.id} finding={f} />)}</ul>
              </section>
            ))
          ) : (
            <EmptyState icon={Sparkles} title="No findings yet" description="Findings appear once there are sales and bookings in the period." />
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Recommended actions" icon={Lightbulb} />
            {data.recommendations.length ? (
              <ol className="space-y-4 px-5 pb-5">
                {data.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold-500/15 text-xs font-semibold text-accent">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.title}</p>
                      <p className="mt-0.5 text-sm text-muted">{r.detail}</p>
                      <Badge className="mt-1.5" tone={PRIORITY_TONE[r.priority]}>{r.priority} priority</Badge>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted">Nothing urgent — keep doing what works.</p>
            )}
          </Card>
          {data.forecast?.projected ? (
            <Card className="p-5">
              <p className="text-sm text-muted">{data.forecast.month} forecast</p>
              <p className="mt-1 text-2xl font-semibold">{formatMoney(data.forecast.projected)}</p>
              <p className="mt-1 text-sm text-muted">
                {formatMoney(data.forecast.toDate)} after {data.forecast.daysElapsed} of {data.forecast.daysInMonth} days
                {data.forecast.change !== null ? ` · ${data.forecast.change > 0 ? '+' : ''}${percent(data.forecast.change)} vs last month` : ''}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3" role="img" aria-label="Month progress">
                <div className="h-full rounded-full bg-gold-500" style={{ width: `${Math.min(100, (data.forecast.toDate / (data.forecast.projected || 1)) * 100)}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">Projection at the current daily rate.</p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
