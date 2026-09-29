import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { Button, Card } from '../../components/ui';
import { employeeApi, employeeKeys } from './api';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Weekly working hours editor (used for booking validation and late detection). */
export function ScheduleEditor({ employeeId, schedule, canEdit }) {
  const qc = useQueryClient();
  const build = () => DAYS.map((_, dayOfWeek) => {
    const found = schedule?.find((d) => d.dayOfWeek === dayOfWeek);
    return found || { dayOfWeek, startTime: '08:00', endTime: '18:00', isWorking: false };
  });
  const [days, setDays] = useState(build);
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDays(build()), [schedule]);

  const update = (index, patch) => setDays((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const save = async () => {
    const invalid = days.find((d) => d.isWorking && d.startTime >= d.endTime);
    if (invalid) {
      toast.error(`${DAYS[invalid.dayOfWeek]}: end time must be after start time`);
      return;
    }
    setSaving(true);
    try {
      await employeeApi.saveSchedule(employeeId, days);
      toast.success('Schedule saved');
      qc.invalidateQueries({ queryKey: employeeKeys.detail(employeeId) });
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setSaving(false);
    }
  };

  const totalHours = days.filter((d) => d.isWorking).reduce((sum, d) => {
    const [sh, sm] = d.startTime.split(':').map(Number);
    const [eh, em] = d.endTime.split(':').map(Number);
    return sum + Math.max(0, eh * 60 + em - (sh * 60 + sm)) / 60;
  }, 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="font-semibold">Weekly schedule</h2>
          <p className="text-sm text-muted">{totalHours.toFixed(1)} hours per week · used to validate bookings</p>
        </div>
        {canEdit ? <Button size="sm" icon={Save} loading={saving} onClick={save}>Save schedule</Button> : null}
      </div>
      <ul className="divide-y divide-line">
        {days.map((d, i) => (
          <li key={d.dayOfWeek} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <label className="flex w-36 items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-4 accent-brand-500" disabled={!canEdit} checked={d.isWorking} onChange={(e) => update(i, { isWorking: e.target.checked })} />
              {DAYS[d.dayOfWeek]}
            </label>
            {d.isWorking ? (
              <div className="flex items-center gap-2">
                <input type="time" aria-label={`${DAYS[d.dayOfWeek]} start`} disabled={!canEdit} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm" value={d.startTime} onChange={(e) => update(i, { startTime: e.target.value })} />
                <span className="text-muted">–</span>
                <input type="time" aria-label={`${DAYS[d.dayOfWeek]} end`} disabled={!canEdit} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm" value={d.endTime} onChange={(e) => update(i, { endTime: e.target.value })} />
              </div>
            ) : (
              <span className="text-sm text-muted">Day off</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
