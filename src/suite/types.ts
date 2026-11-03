/**
 * Workforce Planner sample-data schema (prototype v0.1).
 * These types describe the JSON files in data/sample/. They mirror the prototype's in-memory
 * structures exactly so the golden fixtures stay comparable; see docs/DATA_SCHEMAS.md for units,
 * meanings and the fields that should change in the production contract.
 *
 * Conventions
 * - Week index `i`: 0..NW-1 where i = PAST (8) is the current week (Mon Oct 26 2026). i < PAST is history.
 * - Week offset `w` (fields named from/to/start/due-in-weeks): w = i - PAST, so 0 = this week, negative = past.
 * - Day offset (service `start`, `end`, `due`, `deadline`, visit `to`): days from Mon Oct 26 2026.
 * - Hours are productive labor hours per week unless a field says otherwise. People = hours / HPF (36).
 */

export type TradeKey =
  | 'PF'
  | 'PL'
  | 'SM'
  | 'EL'
  | 'CT'
  | 'PG'
  | 'WE'
  | 'FM'
  | 'AP'
  | 'HS'
  | 'PS';
export type DeptKey = 'GW' | 'NAT' | 'DFW' | 'FL' | 'BAS' | 'HLS';
export type LobName = 'Mechanical' | 'Performance Assurance' | 'Service';
export type ArchKey =
  | 'DC'
  | 'HC'
  | 'K12'
  | 'IND'
  | 'HOSP'
  | 'CTRL'
  | 'BASN'
  | 'CP';
export type WeekSeries = number[]; // length NW (60), indexed by week index i
export type ByTrade<T> = Partial<Record<TradeKey, T>>;
export type ByDept<T> = Record<DeptKey, T>;

// ---------- reference.json ----------
export interface Trade {
  k: TradeKey;
  name: string;
  one: string;
}
export interface Department {
  k: DeptKey;
  name: string;
  group: LobName;
}
export interface LineOfBusiness {
  name: LobName;
  depts: DeptKey[];
}
export interface Archetype {
  name: string;
  share: number;
  mix: ByTrade<number>;
  bas?: boolean;
}
export interface HireLead {
  recruit: number;
  interview: number;
  offer: number;
  onboard: number;
  ramp: number;
} // days
export interface SubcontractLead {
  source: number;
  vet: number;
  mobilize: number;
} // days
export interface OvertimeLead {
  notice: number;
} // days
export type ActionKind =
  | 'hire'
  | 'subcontract'
  | 'overtime'
  | 'leave'
  | 'attrition';
export type ActionStatus =
  | 'Proposed'
  | 'Approved to Recruit'
  | 'Recruiting'
  | 'Offer Accepted'
  | 'Onboarding'
  | 'Productive'
  | 'Sourcing'
  | 'Vetting'
  | 'Contracted'
  | 'Mobilized'
  | 'Executed'
  | 'Delayed'
  | 'Cancelled';
export interface Reference {
  constants: {
    HPF: number;
    SHORT_TE: number;
    ACT_TE: number;
    PAST: number;
    FUT: number;
    NW: number;
    WEEK0: string;
    OT_LIMIT: number;
    REVIEW_THRESHOLD: number;
    RATE_BLENDED: number;
    SV_PAID: number;
    SV_DEDUCT: [string, number][];
    SV_HIGH: number;
  };
  trades: Trade[];
  departments: Department[];
  linesOfBusiness: LineOfBusiness[];
  loadedRates: Record<TradeKey, number>;
  deptManagers: Record<DeptKey, string>;
  actionKinds: [ActionKind, string][];
  statuses: ActionStatus[];
  confirmedStatuses: ActionStatus[];
  leadTimeDefaultsDays: {
    hire: Record<TradeKey, HireLead>;
    subcontract: Record<TradeKey, SubcontractLead>;
    overtime: Record<TradeKey, OvertimeLead>;
  };
  archetypes: Record<ArchKey, Archetype>;
  serviceTiers: Record<'complete' | 'priority' | 'standard', string>;
}

// ---------- weeks.json ----------
export interface Week {
  i: number;
  offset: number;
  weekStart: string;
  holidayFactor: number;
  holiday: string | null;
}

// ---------- crews.json ----------
export interface CapacityBase {
  B: number;
  fte0: number;
  temp0: number;
  pre: number;
  ph: number;
} // hours/week, ph = week offset of the demo crunch
export interface Crews {
  headcount: Record<DeptKey, ByTrade<number>>;
  capacityBase: Record<DeptKey, ByTrade<CapacityBase>>;
}

// ---------- projects.json ----------
export type ProjectType = 'hard' | 'soft' | 'proposed';
export interface Project {
  id: string;
  type: ProjectType;
  name: string;
  arch: ArchKey;
  value: number; // $M
  start: number;
  dur: number; // week offset, weeks
  dept: DeptKey;
  prob: number;
  src: string;
  hours: number;
  mix: ByTrade<number>;
  plan: ByTrade<WeekSeries>; // signed weekly hours by trade (after demo calibration)
  pm?: string;
  job?: string;
  est?: string;
  on?: boolean;
  user?: true;
  scale?: number;
  num?: string;
  loc?: string;
  bid?: string;
  shape?: 'curve' | 'flat';
  hoursOver?: number;
  mixOver?: ByTrade<number>;
}
export interface UserProjectArgs {
  id: string;
  kind: 'proposed' | 'soft';
  dept: DeptKey;
  arch: ArchKey;
  value: number;
  start: number;
  prob: number;
  name: string;
  end?: number;
  shape?: 'curve' | 'flat';
  hours?: number;
  mix?: ByTrade<number>;
  source?: 'manual' | 'estimate';
  file?: string;
  num?: string;
  loc?: string;
  bid?: string;
}
export interface ProjectsFile {
  generatorInputs: {
    hard: {
      name: string;
      arch: ArchKey;
      valueM: number;
      start: number;
      dur: number;
      pm: string;
      job: string;
      dept: DeptKey;
    }[];
    soft: {
      name: string;
      arch: ArchKey;
      valueM: number;
      start: number;
      prob: number;
      est: string;
      dept: DeptKey;
    }[];
    userProjectArgs: UserProjectArgs[];
  };
  projects: Project[];
}

// ---------- dispatch-actuals.json ----------
/** actuals[projectId][trade] = dispatched hours for history weeks i = 0..PAST-1 (hard backlog only) */
export type DispatchActuals = Record<string, ByTrade<number[]>>;

// ---------- capacity-actions.json ----------
export interface CapacityAction {
  id: string;
  src: 'data' | 'plan' | 'rec';
  kind: ActionKind;
  dk: DeptKey;
  tk: TradeKey;
  qty: number; // people (overtime: people-equivalents of hours)
  from: number;
  to: number; // week offsets; for hires `from` = first fully productive week
  status: ActionStatus;
  confirmed: boolean;
  notes: string;
  owner: string;
  lead: Partial<HireLead & SubcontractLead & OvertimeLead>;
  rate: number;
  cost: number; // $/hr loaded; temp labor $/hr or $/month
  sourceType: string;
  costBasis: 'per hour' | 'per month';
  ai?: boolean;
  draft?: boolean;
  due?: number;
  actualOffer?: string;
  actualStart?: string;
}
export interface CapacityActionsFile {
  fromSystems: CapacityAction[];
  addedInPlan: CapacityAction[];
}

// ---------- service.json ----------
export type VisitStatus = 'done' | 'missing' | 'sched' | 'overdue' | 'resched';
export interface Visit {
  id: string;
  due: number;
  bud: number;
  big: boolean;
  ren: boolean;
  flex: boolean;
  win: number;
  status: VisitStatus;
  act?: number;
  to?: number;
}
export interface Renewal {
  status: 'signed' | 'expected' | 'notstarted' | 'atrisk';
  p: number;
  deadline: number;
  label: string;
  owner: string;
}
export interface Agreement {
  id: string;
  name: string;
  tier: 'complete' | 'priority' | 'standard';
  trade: 'HVAC' | 'Plumbing';
  tk: 'HS' | 'PS';
  term: 12 | 36;
  start: number;
  end: number;
  size: number;
  burn: number;
  owner: string;
  ren: Renewal | null;
  visits: Visit[];
}
export interface VisitPlan {
  months: number[];
  big: number[];
  hrs: [number, number];
  bigHrs: [number, number];
}
export interface OpenJob {
  id: string;
  desc: string;
  bill: string;
  hrs: number;
  tk: 'HS' | 'PS';
  wk: number;
  site: string;
  callback: boolean;
}
export interface ServiceFile {
  asOf: string;
  agreements: Agreement[];
  visitPlans: Record<
    'complete' | 'priority' | 'standard' | 'plumbing',
    VisitPlan
  >;
  openJobs: OpenJob[];
  callHistoryBaseHoursPerWeekByMonth: Record<'HS' | 'PS', number[]>;
  highDemandMultiplier: number;
  callbacksLast90Days: { visits: number; hrs: number; rate: number };
  techs: Record<'HS' | 'PS', string[]>;
}

// ---------- scenarios.json ----------
export interface ScenarioSnapshot {
  on: Record<string, boolean>;
  prob: Record<string, number>;
  extra: UserProjectArgs[];
  actions: CapacityAction[];
  manual: Record<string, number[]>;
  review: Record<string, 'accepted' | 'held'>;
  softMode: 'off' | 'weighted' | 'all';
  includeProposed: boolean;
  service?: {
    demand: 'expected' | 'high';
    renewals: boolean;
    leveling: boolean;
    overrides: Record<
      string,
      {
        basis?: 'burn' | 'budget' | 'custom';
        factor?: number;
        renewal?: 'source' | 'signed' | 'expected' | 'none';
        probability?: number;
        moves?: Record<string, number>;
      }
    >;
  };
}
export interface Scenario {
  id: string;
  name: string;
  note?: string;
  seed?: boolean;
  snap: ScenarioSnapshot;
}

// ---------- workforce-sample.json (all of the above in one file) ----------
export interface WorkforceSample {
  schemaVersion: string;
  generatedFrom: string;
  reference: Reference;
  weeks: Week[];
  crews: Crews;
  projects: ProjectsFile;
  dispatch_actuals: DispatchActuals;
  capacity_actions: CapacityActionsFile;
  service: ServiceFile;
  scenarios: Scenario[];
  metadata?: {
    id: string;
    label: string;
    sample: boolean;
    notes: string[];
    capacityKnown?: boolean;
  };
}
