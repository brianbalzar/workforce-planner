import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from 'react';
import type { Tab } from './App';

/** localStorage key marking that a visitor has completed or skipped the tour. */
export const TOUR_SEEN_KEY = 'wfp.tour.seen.v1';

interface TourStep {
  tab: Tab;
  /** CSS selector for the element to spotlight, or null for a centered step. */
  selector: string | null;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

// Each step names the tab it needs and a [data-tour="..."] selector already
// present on the corresponding element in App.tsx. Keep this list in sync
// with those attributes — a missing target just skips the spotlight (the
// callout still centers itself) rather than breaking the tour.
export const TOUR_STEPS: TourStep[] = [
  {
    tab: 'dashboard',
    selector: null,
    title: 'Welcome to the Workforce Planner',
    body: 'This planner combines Hard and Soft Backlog with working scenario assumptions. The data-status banner always identifies whether you are viewing published, uploaded, or demonstration data.',
  },
  {
    tab: 'dashboard',
    selector: '[data-tour="banner"]',
    title: 'Check the data status',
    body: 'This banner identifies published data and its publication date, or clearly labels session-only, demonstration, and development-fallback data. It stays visible on every screen.',
    placement: 'bottom',
  },
  {
    tab: 'dashboard',
    selector: '[data-tour="tabs"]',
    title: 'Six screens, one workflow',
    body: 'Dashboard shows the bottleneck. Projects & Forecasts holds the backlog. Scenario Builder plans a response. Workforce Capacity is the department roster. Saved Plans compares options. Help has the full written guide.',
    placement: 'bottom',
  },
  {
    tab: 'dashboard',
    selector: '[data-tour="quick-add"]',
    title: 'Add from anywhere',
    body: 'These two buttons are always in the header. Add Proposed Project tests new demand. Add Capacity Action opens a hire, subcontract, overtime, leave, or attrition change — the same actions Scenario Builder step 5 uses, without leaving the screen you\u2019re on.',
    placement: 'bottom',
  },
  {
    tab: 'dashboard',
    selector: '[data-tour="bottleneck-chart"]',
    title: 'Demand versus capacity',
    body: 'The lines are demand — hard backlog, expected, and full scenario workload. The stacked bars are executable capacity. Wherever a line rises above the bars, that month has a staffing gap.',
    placement: 'top',
  },
  {
    tab: 'dashboard',
    selector: '[data-tour="unit-toggle"]',
    title: 'Three views of the same numbers',
    body: 'Switch between People (FTE), Hours, and Labor Cost. Every chart and metric updates immediately — nothing on this screen needs a save or recalculate step.',
    placement: 'bottom',
  },
  {
    tab: 'dashboard',
    selector: '[data-tour="month-jump"]',
    title: 'Drill into any month',
    body: 'Click a bar on the chart, or use this dropdown, to see exactly which projects and capacity sources make up that month’s total.',
    placement: 'bottom',
  },
  {
    tab: 'dashboard',
    selector: '[data-tour="composition-chart"]',
    title: 'What makes up each month',
    body: 'This stacked chart breaks demand into its largest contributing projects, so you can see which backlog items are driving a given month.',
    placement: 'top',
  },
  {
    tab: 'projects',
    selector: '[data-tour="projects-table"]',
    title: 'The backlog feeding the plan',
    body: 'Every project or forecast contributing demand lives here. Toggle a project off, adjust a soft project’s probability, or shift its start date — the dashboard updates the instant you do.',
    placement: 'top',
  },
  {
    tab: 'projects',
    selector: '[data-tour="overlap"]',
    title: 'Who is on site, month by month',
    body: 'This timeline shows each project’s active window and peak crew side by side. Click a bar to open that project, or a month header to jump back to the dashboard’s breakdown for that month.',
    placement: 'top',
  },
  {
    tab: 'scenario',
    selector: '[data-tour="scenario"]',
    title: 'Plan the response',
    body: 'Work through these steps to add hires, subcontractors, overtime, leave, or attrition. Dates are calculated backward from when capacity actually needs to be ready.',
    placement: 'right',
  },
  {
    tab: 'capacity',
    selector: '[data-tour="capacity"]',
    title: 'Today’s department roster',
    body: 'This is the existing headcount the plan is measured against — the baseline every hire, subcontract, and overtime action in the scenario builder adds on top of.',
    placement: 'top',
  },
  {
    tab: 'plans',
    selector: '[data-tour="plans"]',
    title: 'Save, compare, and approve',
    body: 'A scenario becomes a plan once you save it. Save a few variations to compare them side by side, or move a plan through Draft → Under Review → Approved.',
    placement: 'top',
  },
  {
    tab: 'dashboard',
    selector: '[data-tour="help-menu"]',
    title: 'Come back anytime',
    body: 'Replay this tour or open the full written pilot guide from here whenever you need a refresher.',
    placement: 'bottom',
  },
];

function markSeen() {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // best-effort only — a private-mode/blocked-storage browser just
    // means the tour offers to play again next visit.
  }
}

function calloutStyle(
  rect: DOMRect | null,
  placement: 'top' | 'bottom' | 'left' | 'right',
): CSSProperties {
  if (!rect) {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }
  const gap = 16;
  const width = 320;
  const clampLeft = (v: number) =>
    Math.max(12, Math.min(v, window.innerWidth - width - 12));
  const clampTop = (v: number) =>
    Math.max(12, Math.min(v, window.innerHeight - 12));
  if (placement === 'top')
    return {
      left: clampLeft(rect.left),
      top: clampTop(rect.top - gap),
      transform: 'translateY(-100%)',
    };
  if (placement === 'left')
    return {
      top: clampTop(rect.top),
      left: Math.max(12, rect.left - gap),
      transform: 'translateX(-100%)',
    };
  if (placement === 'right')
    return { top: clampTop(rect.top), left: clampLeft(rect.right + gap) };
  return { left: clampLeft(rect.left), top: clampTop(rect.bottom + gap) };
}

export function GuidedTour({
  active,
  tab,
  setTab,
  onFinish,
}: {
  active: boolean;
  tab: Tab;
  setTab: (t: Tab) => void;
  onFinish: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [wasActive, setWasActive] = useState(active);
  const step = TOUR_STEPS[Math.min(stepIndex, TOUR_STEPS.length - 1)];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  const finish = useCallback(() => {
    markSeen();
    onFinish();
  }, [onFinish]);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= TOUR_STEPS.length - 1) {
        markSeen();
        onFinish();
        return i;
      }
      return i + 1;
    });
  }, [onFinish]);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  // Reset to the first step every time the tour (re)starts. This adjusts
  // state during render rather than in an effect, which avoids an extra
  // render pass for a value derived purely from a prop change.
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setStepIndex(0);
  }

  // Switch to whichever tab the current step needs.
  useEffect(() => {
    if (active && step.tab !== tab) setTab(step.tab);
  }, [active, step.tab, tab, setTab]);

  // Locate and track the target element for the current step.
  useLayoutEffect(() => {
    if (!active || !step.selector) return;
    let cancelled = false;
    const selector = step.selector;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(selector);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const locateAndScroll = () => {
      const el = document.querySelector(selector);
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      measure();
    };
    // Give a just-triggered tab switch one frame to render before measuring.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(locateAndScroll),
    );
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, step.selector, stepIndex]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, finish, next, back]);

  if (!active) return null;
  const showSpotlight = Boolean(step.selector && rect);

  return (
    <div
      className="tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
    >
      <div className="tour-click-shield" />
      {showSpotlight && rect ? (
        <div
          className="tour-spotlight"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div
        className="tour-callout"
        style={calloutStyle(rect, step.placement ?? 'bottom')}
      >
        <span>
          STEP {stepIndex + 1} OF {TOUR_STEPS.length}
        </span>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-progress">
          {TOUR_STEPS.map((s, i) => (
            <i key={s.title} className={i === stepIndex ? 'on' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button onClick={finish}>Skip tour</button>
          <div>
            {stepIndex > 0 && <button onClick={back}>Back</button>}
            <button className="primary" onClick={next}>
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
