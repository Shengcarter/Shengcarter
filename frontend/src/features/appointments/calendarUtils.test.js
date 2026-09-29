import { describe, expect, it } from 'vitest';
import { layoutDay, layoutLanes } from './calendarUtils';

const at = (hhmm, minutes, id) => {
  const start = new Date(`2026-10-01T${hhmm}:00Z`);
  return { id, customerName: `C${id}`, startTime: start.toISOString(), endTime: new Date(start.getTime() + minutes * 60_000).toISOString() };
};

describe('layoutDay', () => {
  it('puts overlapping events side by side and separate groups full width', () => {
    const events = layoutLanes([at('09:00', 60, 1), at('09:30', 60, 2), at('11:00', 30, 3)]);
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    expect([byId[1].lane, byId[1].lanes]).toEqual([0, 2]);
    expect([byId[2].lane, byId[2].lanes]).toEqual([1, 2]);
    expect([byId[3].lane, byId[3].lanes]).toEqual([0, 1]);
  });

  it('shows every event when the lanes fit', () => {
    const { events, more } = layoutDay([at('09:00', 60, 1), at('09:00', 60, 2)], { maxLanes: 2, maxLanesWithMore: 1 });
    expect(events).toHaveLength(2);
    expect(events.every((e) => !e.reserve)).toBe(true);
    expect(more).toEqual([]);
  });

  it('hides lanes that do not fit behind "+N" chips and reserves room for them', () => {
    const input = [at('09:00', 120, 1), at('09:00', 60, 2), at('09:05', 60, 3), at('09:10', 60, 4), at('10:30', 30, 5)];
    const { events, more } = layoutDay(input, { maxLanes: 2, maxLanesWithMore: 1 });
    // Only the first lane is kept; event 5 (10:30) sits in lane 2 because
    // event 1 still occupies lane 1, so it is hidden too.
    expect(events.map((e) => e.id)).toEqual([1]);
    expect(events[0]).toMatchObject({ lane: 0, lanes: 1, reserve: true });
    // 09:00, 09:05 and 09:10 start within one chip's height: one chip.
    expect(more.map((c) => c.events.map((e) => e.id))).toEqual([[2, 3, 4], [5]]);
    expect(more[0].count).toBe(3);
  });

  it('gives hidden events far apart their own chips', () => {
    const input = [at('09:00', 300, 1), at('09:00', 60, 2), at('12:00', 60, 3)];
    const { more } = layoutDay(input, { maxLanes: 1, maxLanesWithMore: 1 });
    expect(more.map((c) => c.events.map((e) => e.id))).toEqual([[2], [3]]);
  });

  it('never hides the whole group', () => {
    const input = [at('09:00', 60, 1), at('09:00', 60, 2), at('09:00', 60, 3)];
    const { events, more } = layoutDay(input, { maxLanes: 0, maxLanesWithMore: 0 });
    expect(events).toHaveLength(1);
    expect(more[0].count).toBe(2);
  });
});
