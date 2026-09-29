import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { CheckCircle2, GripVertical } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatTime, nowInBusinessZone } from '../../utils/format';
import { PX_PER_MIN, STATUS_STYLES, layoutLanes, minutesOfDay } from './calendarUtils';

function hexToRgba(hex, alpha) {
  const value = hex?.replace('#', '') || 'D4AF37';
  const n = Number.parseInt(value, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function EventCard({ event, compact, dragging }) {
  const color = event.employeeColor || '#D4AF37';
  return (
    <div
      className={cn(
        'h-full overflow-hidden rounded-lg border-l-[3px] px-2 py-1 text-left text-xs shadow-sm',
        STATUS_STYLES[event.status],
        dragging && 'shadow-xl ring-2 ring-gold-500',
      )}
      style={{ background: hexToRgba(color, 0.16), borderLeftColor: color }}
    >
      <p className="flex items-center gap-1 font-semibold text-fg">
        <span className="truncate">{formatTime(event.startTime)} · {event.customerName}</span>
        {event.checkedInAt && event.status !== 'completed' ? <CheckCircle2 className="size-3 shrink-0 text-success" aria-label="Checked in" /> : null}
      </p>
      {!compact ? <p className="truncate text-muted">{event.services}</p> : null}
      {!compact ? <p className="truncate text-muted">{event.employeeName}</p> : null}
    </div>
  );
}

function DraggableEvent({ event, top, height, left, width, canDrag, onClick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `appt-${event.id}`, data: { event }, disabled: !canDrag });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onClick(event)}
      {...(canDrag ? listeners : {})}
      {...attributes}
      aria-roledescription={canDrag ? 'Draggable appointment' : 'Appointment'}
      aria-label={`${formatTime(event.startTime)} ${event.customerName}, ${event.services}, ${event.status.replace('_', ' ')}`}
      className={cn('group absolute z-10 p-0.5 focus:z-20 focus:outline-none', canDrag && 'cursor-grab active:cursor-grabbing', isDragging && 'opacity-30')}
      style={{ top, height, left: `${left}%`, width: `${width}%` }}
    >
      <EventCard event={event} compact={height < 44} />
      {canDrag ? <GripVertical className="absolute top-1 right-1 size-3 text-muted opacity-0 group-hover:opacity-100" aria-hidden /> : null}
    </button>
  );
}

function Column({ column, isFirst, events, hours, canDrag, onEventClick, onSlotClick, slotMinutes }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, data: { column } });
  const laid = useMemo(() => layoutLanes(events), [events]);
  const totalMinutes = (hours.end - hours.start) * 60;
  const [now, setNow] = useState(() => nowInBusinessZone());
  useEffect(() => {
    const timer = setInterval(() => setNow(nowInBusinessZone()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const showNow = column.date === now.toISODate();
  const nowTop = (now.hour * 60 + now.minute - hours.start * 60) * PX_PER_MIN;

  const clickSlot = (e) => {
    if (!onSlotClick || e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.floor((e.clientY - rect.top) / PX_PER_MIN / slotMinutes) * slotMinutes + hours.start * 60;
    onSlotClick(column, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  };

  return (
    <div
      ref={setNodeRef}
      onClick={clickSlot}
      className={cn('relative border-l border-line', isOver && 'bg-gold-500/5', column.closed && 'bg-surface-2/60', onSlotClick && 'cursor-cell')}
      style={{ height: totalMinutes * PX_PER_MIN }}
    >
      {Array.from({ length: hours.end - hours.start }).map((_, i) => (
        <div key={i} className="pointer-events-none absolute inset-x-0 border-t border-line/70" style={{ top: i * 60 * PX_PER_MIN }} />
      ))}
      {laid.map((event) => {
        const start = minutesOfDay(event.startTime) - hours.start * 60;
        const duration = (new Date(event.endTime) - new Date(event.startTime)) / 60_000;
        return (
          <DraggableEvent
            key={event.id}
            event={event}
            top={Math.max(0, start * PX_PER_MIN)}
            height={Math.max(22, duration * PX_PER_MIN)}
            left={(event.lane / event.lanes) * 100}
            width={100 / event.lanes}
            canDrag={canDrag(event)}
            onClick={onEventClick}
          />
        );
      })}
      {showNow && nowTop >= 0 && nowTop <= totalMinutes * PX_PER_MIN ? (
        <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: nowTop }} aria-hidden>
          {isFirst ? <span className="-ml-1 size-2 rounded-full bg-red-500" /> : null}
          <span className="h-px flex-1 bg-red-500" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Time grid with drag-and-drop rescheduling.
 * columns: [{ id, title, subtitle?, date, employeeId?, closed? }]
 * eventColumn(event) → column id the event belongs to.
 * onMove({ event, column, minutesDelta }) is called after a drop.
 */
export function TimeGrid({ columns, events, hours, slotMinutes, eventColumn, canDrag, onEventClick, onMove, onSlotClick }) {
  const scrollRef = useRef(null);
  const [active, setActive] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  // Snap the dragged card to the booking interval while moving.
  const snap = ({ transform }) => {
    const step = slotMinutes * PX_PER_MIN;
    return { ...transform, y: Math.round(transform.y / step) * step };
  };

  useEffect(() => {
    // Scroll to the current hour (or opening time) on first render.
    const now = nowInBusinessZone();
    const target = Math.max(0, (Math.max(now.hour - 1, hours.start) - hours.start) * 60 * PX_PER_MIN);
    if (scrollRef.current) scrollRef.current.scrollTop = target;
  }, [hours.start]);

  const onDragEnd = ({ active: dragged, over, delta }) => {
    setActive(null);
    if (!over) return;
    const event = dragged.data.current.event;
    const minutesDelta = Math.round(delta.y / PX_PER_MIN / slotMinutes) * slotMinutes;
    const column = over.data.current.column;
    if (!minutesDelta && column.id === eventColumn(event)) return;
    onMove({ event, column, minutesDelta });
  };

  const gridCols = { gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(${columns.length > 4 ? '7.5rem' : '10rem'}, 1fr))` };

  return (
    <DndContext sensors={sensors} onDragStart={({ active: a }) => setActive(a.data.current.event)} onDragCancel={() => setActive(null)} onDragEnd={onDragEnd}>
      <div ref={scrollRef} className="scrollbar-thin max-h-[calc(100dvh-15rem)] min-h-96 overflow-auto">
        <div className="sticky top-0 z-30 grid border-b border-line bg-surface" style={gridCols}>
          <div />
          {columns.map((c) => (
            <div key={c.id} className="border-l border-line px-2 py-2.5 text-center">
              <p className="flex items-center justify-center gap-1.5 truncate text-sm font-semibold">
                {c.color ? <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden /> : null}
                {c.title}
              </p>
              {c.subtitle ? <p className={cn('truncate text-xs', c.highlight ? 'font-semibold text-accent' : 'text-muted')}>{c.subtitle}</p> : null}
            </div>
          ))}
        </div>
        <div className="grid" style={gridCols}>
          <div className="relative" style={{ height: (hours.end - hours.start) * 60 * PX_PER_MIN }}>
            {Array.from({ length: hours.end - hours.start }).map((_, i) => (
              <span key={i} className="absolute right-2 -translate-y-1/2 text-[11px] text-muted tabular-nums" style={{ top: i * 60 * PX_PER_MIN }}>
                {i === 0 ? '' : `${String(hours.start + i).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>
          {columns.map((column, index) => (
            <Column
              key={column.id}
              column={column}
              isFirst={index === 0 || column.date !== columns[index - 1].date}
              events={events.filter((e) => eventColumn(e) === column.id)}
              hours={hours}
              canDrag={canDrag}
              onEventClick={onEventClick}
              onSlotClick={onSlotClick}
              slotMinutes={slotMinutes}
            />
          ))}
        </div>
      </div>
      <DragOverlay modifiers={[snap]} dropAnimation={null}>
        {active ? (
          <div style={{ height: Math.max(22, ((new Date(active.endTime) - new Date(active.startTime)) / 60_000) * PX_PER_MIN), width: 160 }}>
            <EventCard event={active} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
