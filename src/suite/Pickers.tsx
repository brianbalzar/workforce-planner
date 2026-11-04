import { useEffect, useRef, type ReactNode } from 'react';
import type { DeptKey, TradeKey } from './types';

/* Department and labor-category pickers, styled after the Projects demo
   (claude.ai artifact "Projects Workforce Planner"): trigger with a colour
   key, title and subtitle; panel with grouped rows, custom checkboxes,
   counts, gap sparklines and a footer of quick actions. */

export const DEPT_COLORS = [
  '#161514',
  '#0068cc',
  '#b8740b',
  '#007a3d',
  '#6e4b9e',
  '#b0457a',
];

function Check({ on }: { on: boolean }) {
  return (
    <span className={`ws-pk-box${on ? ' on' : ''}`} aria-hidden="true">
      {on && (
        <svg width="10" height="8" viewBox="0 0 10 8">
          <polyline
            points="1,4 4,7 9,1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

function Popover({
  label,
  open,
  onOpen,
  onClose,
  trigger,
  wide,
  children,
}: {
  label: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  trigger: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        ref.current?.querySelector<HTMLButtonElement>('.ws-pk-trig')?.focus();
      }
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open, onClose]);
  return (
    <div className="ws-pk" ref={ref}>
      <span className="ws-eyebrow">{label}</span>
      <button
        type="button"
        className="ws-pk-trig"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
      >
        {trigger}
        <span className="ws-pk-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className={`ws-pk-panel${wide ? ' wide' : ''}`}
          role="dialog"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export interface DeptRow {
  k: DeptKey;
  name: string;
  group: string;
  count: number;
  unit: string;
}

export function DepartmentPicker({
  rows,
  selected,
  onChange,
  open,
  onOpen,
  onClose,
}: {
  rows: DeptRow[];
  selected: DeptKey[];
  onChange: (next: DeptKey[]) => void;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const all = selected.length === rows.length;
  const color = (k: DeptKey) =>
    DEPT_COLORS[rows.findIndex((r) => r.k === k) % DEPT_COLORS.length];
  const name = (k: DeptKey) => rows.find((r) => r.k === k)?.name ?? k;
  const title =
    selected.length === 1
      ? name(selected[0])
      : all
        ? 'All departments'
        : `${selected.length} departments`;
  const lead = rows.find((r) => r.k === selected[0]);
  const sub =
    selected.length === 1 && lead
      ? `${lead.group} · ${lead.count} ${lead.unit}`
      : `${selected.length} selected · gaps kept separate`;
  const groups = [...new Set(rows.map((r) => r.group))];
  const toggle = (k: DeptKey) =>
    onChange(
      selected.includes(k)
        ? selected.length > 1
          ? selected.filter((v) => v !== k)
          : selected
        : rows.map((r) => r.k).filter((v) => v === k || selected.includes(v)),
    );
  return (
    <Popover
      label="Department"
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      trigger={
        <>
          <i className="ws-pk-dot" style={{ background: color(selected[0]) }} />
          <span className="ws-pk-tt">
            <strong>{title}</strong>
            <small>{sub}</small>
          </span>
        </>
      }
    >
      <div className="ws-pk-body">
        {groups.map((g) => {
          const gr = rows.filter((r) => r.group === g);
          return (
            <div key={g} role="group" aria-label={g}>
              <div className="ws-pk-h">
                <span>{g}</span>
                <span>
                  {gr[0].unit === 'agreements' ? 'Agreements' : 'Jobs in plan'}
                </span>
              </div>
              {gr.map((r) => {
                const on = selected.includes(r.k);
                return (
                  <div key={r.k} className={`ws-pk-row${on ? ' on' : ''}`}>
                    <button
                      type="button"
                      className="ws-pk-tog"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(r.k)}
                    >
                      <Check on={on} />
                      <i
                        className="ws-pk-dot"
                        style={{
                          background: on ? color(r.k) : 'var(--ws-line)',
                        }}
                      />
                      <span className="ws-pk-name">
                        <b>{r.name}</b>
                        <small>
                          {on ? 'Included' : 'Not shown'} · {r.count} {r.unit}
                        </small>
                      </span>
                    </button>
                    <span className="ws-pk-count">{r.count}</span>
                    <span className="ws-pk-act">
                      {!(on && selected.length === 1) && (
                        <button
                          type="button"
                          className="ws-pk-set"
                          onClick={() => onChange([r.k])}
                          title={`Show only ${r.name}`}
                        >
                          Only
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="ws-pk-foot">
        <span>Shortfalls count department by department.</span>
        <span className="ws-pk-links">
          {!all && (
            <button
              type="button"
              className="ws-pk-link"
              onClick={() => onChange(rows.map((r) => r.k))}
            >
              Select all departments
            </button>
          )}
          <button type="button" className="ws-pk-link muted" onClick={onClose}>
            Done
          </button>
        </span>
      </div>
    </Popover>
  );
}

function Spark({
  values,
  max,
  color,
}: {
  values: number[];
  max: number;
  color: string;
}) {
  const has = values.some((v) => v > 0.05);
  const pts = values
    .map(
      (v, k) =>
        `${((k / Math.max(1, values.length - 1)) * 74).toFixed(1)},${(17 - Math.min(15, (v / max) * 15)).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg width="74" height="18" viewBox="0 0 74 18" aria-hidden="true">
      <line x1="0" y1="17" x2="74" y2="17" stroke="var(--ws-line)" />
      <polyline
        points={pts}
        fill="none"
        stroke={has ? color : 'var(--ws-line)'}
        strokeWidth="1.5"
      />
    </svg>
  );
}

export interface TradeRow {
  k: TradeKey;
  name: string;
  /** Gap in people per future week, summed across the selected departments. */
  gap: number[];
}

export function TradePicker({
  rows,
  selected,
  colors,
  horizon,
  onChange,
  open,
  onOpen,
  onClose,
}: {
  rows: TradeRow[];
  selected: TradeKey[];
  colors: string[];
  horizon: number;
  onChange: (next: TradeKey[]) => void;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const ordered = rows.map((r) => r.k).filter((k) => selected.includes(k));
  const color = (k: TradeKey) =>
    colors[ordered.indexOf(k) % colors.length] ?? 'var(--ws-line)';
  const peak = (r: TradeRow) => Math.max(0, ...r.gap);
  const gmax = Math.max(1, ...rows.map(peak));
  const all = selected.length === rows.length;
  const name = (k: TradeKey) => rows.find((r) => r.k === k)?.name ?? k;
  const title =
    selected.length === 1
      ? name(selected[0])
      : all
        ? 'All labor categories'
        : selected.length === 2
          ? `${name(ordered[0])} + 1`
          : `${selected.length} labor categories`;
  const constrained = rows.filter((r) => peak(r) > 0.05).map((r) => r.k);
  const short = rows.filter(
    (r) => selected.includes(r.k) && peak(r) > 0.05,
  ).length;
  const sub = `${selected.length} selected · ${short ? `${short} short` : 'no shortfall'}`;
  const toggle = (k: TradeKey) =>
    onChange(
      selected.includes(k)
        ? selected.length > 1
          ? selected.filter((v) => v !== k)
          : selected
        : rows.map((r) => r.k).filter((v) => v === k || selected.includes(v)),
    );
  return (
    <Popover
      label="Labor categories"
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      wide
      trigger={
        <>
          <i className="ws-pk-sw" style={{ background: color(ordered[0]) }} />
          <span className="ws-pk-tt">
            <strong>{title}</strong>
            <small>{sub}</small>
          </span>
        </>
      }
    >
      <div className="ws-pk-h cat">
        <span>Category</span>
        <span>Gap shape</span>
        <span>Peak</span>
        <span />
      </div>
      <div className="ws-pk-body">
        {rows.map((r) => {
          const on = selected.includes(r.k),
            pk = peak(r),
            col = on ? color(r.k) : 'var(--ws-line)';
          return (
            <div key={r.k} className={`ws-pk-row cat${on ? ' on' : ''}`}>
              <button
                type="button"
                className="ws-pk-tog"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(r.k)}
              >
                <Check on={on} />
                <i className="ws-pk-sw" style={{ background: col }} />
                <span className="ws-pk-name">
                  <b>{r.name}</b>
                </span>
              </button>
              <Spark values={r.gap} max={gmax} color={col} />
              <span className={`ws-pk-count${pk > 0.05 ? ' neg' : ''}`}>
                {pk > 0.05 ? `−${pk.toFixed(1)}` : '—'}
              </span>
              <span className="ws-pk-act">
                {!(on && selected.length === 1) && (
                  <button
                    type="button"
                    className="ws-pk-set"
                    onClick={() => onChange([r.k])}
                    title={`Show only ${r.name}`}
                  >
                    Only
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="ws-pk-foot">
        <span className="ws-pk-links">
          {constrained.length > 0 && (
            <button
              type="button"
              className="ws-pk-link"
              onClick={() => onChange(constrained)}
            >
              Select every constrained category
            </button>
          )}
          <button
            type="button"
            className="ws-pk-link muted"
            onClick={() => onChange(rows.map((r) => r.k))}
          >
            All
          </button>
          <button type="button" className="ws-pk-link muted" onClick={onClose}>
            Done
          </button>
        </span>
        <span>
          {selected.length} selected · peak gap in people, summed across
          departments, next {horizon} wks
        </span>
      </div>
    </Popover>
  );
}
