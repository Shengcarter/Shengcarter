import { MessageSquareWarning, ThumbsUp, Timer } from 'lucide-react';
import { Badge } from '../../components/ui';
import { cn } from '../../utils/cn';
import { formatDateTime } from '../../utils/format';

/**
 * The customer's WhatsApp reply to a booking confirmation or reminder:
 * confirmed, running late (with minutes) or asking to cancel / change.
 */
const REPLIES = {
  confirmed: { icon: ThumbsUp, tone: 'success', color: 'text-success', label: () => 'Customer confirmed' },
  late: { icon: Timer, tone: 'warning', color: 'text-warning', label: (m) => (m ? `Running ${m} min late` : 'Running late') },
  cancel_request: { icon: MessageSquareWarning, tone: 'danger', color: 'text-danger', label: () => 'Wants to cancel or change' },
};

export function replyInfo(appointment) {
  const reply = REPLIES[appointment?.customerResponse];
  if (!reply) return null;
  return { ...reply, text: reply.label(appointment.customerDelayMinutes) };
}

/** Small icon for calendar cards and lists (with "+15m" for a delay). */
export function ReplyIcon({ appointment, className }) {
  const info = replyInfo(appointment);
  if (!info || ['completed', 'cancelled', 'no_show'].includes(appointment.status)) return null;
  const Icon = info.icon;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-0.5', info.color, className)} title={info.text}>
      <Icon className="size-3" aria-label={info.text} />
      {appointment.customerResponse === 'late' && appointment.customerDelayMinutes ? (
        <span className="text-[10px] font-semibold tabular-nums" aria-hidden>+{appointment.customerDelayMinutes}m</span>
      ) : null}
    </span>
  );
}

/** Badge for the appointment header. */
export function ReplyBadge({ appointment }) {
  const info = replyInfo(appointment);
  if (!info) return null;
  const Icon = info.icon;
  return <Badge tone={info.tone}><Icon className="size-3" aria-hidden />{info.text}</Badge>;
}

/** The reply as the customer wrote it, with when it arrived. */
export function ReplyNote({ appointment }) {
  const info = replyInfo(appointment);
  if (!info) return null;
  return (
    <div className={cn('rounded-2xl border px-4 py-3 text-sm', {
      success: 'border-green-500/30 bg-green-500/5',
      warning: 'border-amber-500/30 bg-amber-500/5',
      danger: 'border-red-500/30 bg-red-500/5',
    }[info.tone])}
    >
      <p className={cn('flex items-center gap-1.5 font-medium', info.color)}>
        <info.icon className="size-4" aria-hidden />
        {info.text}
      </p>
      {appointment.customerResponseNote ? <p className="mt-1 text-fg">“{appointment.customerResponseNote}”</p> : null}
      <p className="mt-1 text-xs text-muted">
        Replied on WhatsApp · {formatDateTime(appointment.customerResponseAt)}
        {appointment.customerResponse === 'cancel_request' ? ' · Call the customer to cancel or move the appointment.' : ''}
      </p>
    </div>
  );
}
