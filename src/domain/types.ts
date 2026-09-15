export type Unit = 'People' | 'Hours' | 'Labor Cost';
export type PlanStatus =
  | 'Draft'
  | 'Under Review'
  | 'Approved Operating Plan'
  | 'Superseded'
  | 'Archived';
// Labor categories are data-owned. The demo dataset supplies the familiar
// categories, while a published dataset can add organization-specific roles
// (for example, Material Handler) without requiring an app release.
export type LaborCategory = string;
export type StaffingCurve =
  | 'Comparable-project curve'
  | 'Standard ramp / peak / taper'
  | 'Even distribution'
  | 'Manual monthly forecast';
export type ActionKind =
  | 'hire'
  | 'subcontract'
  | 'overtime'
  | 'leave'
  | 'attrition';

// --- Portfolio-planning additions (source-forecast rollup) -----------------
// These describe how a single project's own weekly/monthly labor forecast
// (as produced by a project-level tool such as a labor tracker workbook)
// rolls up into this department-level portfolio planner. They intentionally
// stop short of that project-level tool's scope — see MVP notes on each type.

/** Assumed hours in a standard workweek for a project or phase. */
export type WorkweekHours = 40 | 50 | 60;

/**
 * How confidently a project's People-view headcount is known.
 * - 'weekly-peak': a real weekly staffing histogram was available; this is
 *   the true highest concurrent crew requirement within the month.
 * - 'monthly-planned': a time-phased monthly workforce forecast was
 *   available (coarser than weekly, but still a genuine staffing plan).
 * - 'even-spread-estimate': no time-phased staffing data was available, so
 *   headcount was implied by dividing monthly hours across a standard
 *   workweek. This can conceal a short, sharp staffing peak and must always
 *   be labeled as an assumption, never presented as a confirmed peak.
 */
export type PeopleBasis =
  | 'weekly-peak'
  | 'monthly-planned'
  | 'even-spread-estimate';

export type FreshnessStatus =
  | 'Current'
  | 'Approaching stale'
  | 'Stale'
  | 'Missing';

export type FlagSeverity = 'info' | 'warning' | 'critical';

/**
 * A single data-quality or assumption flag surfaced to the user instead of
 * being hidden behind one aggregate confidence score. See
 * REVIEW_RECOMMENDATIONS-adjacent portfolio-planning requirements: every
 * flag names its severity, what it means, what produced it, how it affects
 * the bottleneck analysis, and what would resolve it.
 */
export interface AssumptionFlag {
  id: string;
  severity: FlagSeverity;
  summary: string;
  detail: string;
  effect: string;
  recommendation: string;
}

/**
 * The three distinct People-view metrics a source forecast can support.
 * Never collapse these into one number — see the worked example in the
 * portfolio-planning requirements (weekly 10/10/25/10 must show a peak of
 * 25, not an hours-derived average).
 */
export interface PeopleMetrics {
  peakCrew: number;
  peakCrewMonth: string;
  averageImpliedPeople: number;
  monthlyPlannedPeople?: number;
  basis: PeopleBasis;
}

export interface WorkPackage {
  id: string;
  name: string;
  valuePercent: number;
  startIndex: number;
  durationMonths: number;
  laborAllocation: Partial<Record<LaborCategory, number>>;
  curve: number[];
  staffingCurve: StaffingCurve;
  execution: 'Self-perform' | 'Subcontract' | 'Hybrid';
  selfPerformPercent: number;
  subcontractPercent: number;
  included: boolean;
  confidence: number;
  scenarioShift: number;
  baselineSelfPerformPercent?: number;
  baselineStaffingCurve?: StaffingCurve;
  baselineDurationMonths?: number;
  manualMonthly?: number[];
}
export interface Project {
  id: string;
  name: string;
  department: string;
  projectType?: string;
  bidDate?: string;
  estimateFileName?: string;
  type: 'Hard' | 'Soft';
  value: number;
  planningProbability: number;
  sourceProbability: number;
  startIndex: number;
  curve: number[];
  /** Whether curve values are total internal FTE or a legacy base-category curve. */
  curveBasis?: 'total-internal-labor' | 'base-category';
  /** Inputs used to create an editable Soft Backlog staffing curve. */
  softBacklogForecast?: {
    totalLaborHours: number;
    startMonth: string;
    endMonth: string;
    method: 'straight-line' | 'bell-curve';
    productiveHoursPerFteMonth: number;
    generated: boolean;
  };
  method: string;
  quality: string;
  primaryLabor: string;
  costMix: {
    material: number;
    internalLabor: number;
    subcontract: number;
    other: number;
  };
  laborAllocation: Partial<Record<LaborCategory, number>>;
  workPackages?: WorkPackage[];
  /**
   * Schedule/cost completion to date, 0-100. Only meaningful for awarded
   * ('Hard') work already underway — undefined for soft/proposed projects
   * that have not started. Sourced from the project's own tracking, not
   * derived from the demand curve (the curve is remaining forecast only).
   */
  percentComplete?: number;
  /** Assumed workweek this project's forecast was built on. Defaults to 40. */
  workweekHours?: WorkweekHours;
  /**
   * The source forecast's own labor-classification label(s) for this
   * project's crew (e.g. a project-level labor tracker's own trade
   * breakdown), before mapping to this planner's standardized
   * LaborCategory list. Traceability only — not used in calculations.
   */
  sourceLaborLabels?: string[];
  /**
   * Real weekly crew-count data for at least the busiest stretch of the
   * project, when available. Index 0 = the project's startIndex month,
   * week 0. When present, People-view peak crew is computed as the true
   * max across these weeks rather than implied from monthly hours.
   */
  weeklyCrew?: number[];
  /** ISO date the source forecast was last revised. Drives freshness. */
  lastRevisionDate?: string;
  /**
   * Fabricated job-site location (city, state), distinct from
   * `department` (an org/business-unit grouping). Used by the Portfolio
   * Overlap view's "by location" grouping.
   */
  location?: string;
}
export interface ProposedProject {
  id: string;
  name: string;
  department: string;
  projectType: string;
  /** Which ProposedProjectArchetype this was created from, if any — drives
   * the ADJUSTED badge / "Reset to archetype" drift comparison. Undefined
   * for projects created before archetypes existed. */
  archetypeId?: string;
  value: number;
  startIndex: number;
  durationMonths: number;
  probability: number;
  staffingCurve: StaffingCurve;
  costMix: {
    material: number;
    internalLabor: number;
    subcontract: number;
    other: number;
  };
  laborAllocation: Record<LaborCategory, number>;
  workPackages: WorkPackage[];
}
/**
 * Data-owned rules of thumb used to seed the lightweight proposed-project
 * workflow. These are deliberately separate from a proposed project itself:
 * the data pipeline can refine the assumptions without an app release, while
 * users can still adjust the generated project before saving it.
 */
export interface ProposedProjectArchetype {
  id: string;
  name: string;
  projectType: string;
  defaultDurationMonths: number;
  staffingCurve: StaffingCurve;
  costMix: {
    material: number;
    internalLabor: number;
    subcontract: number;
    other: number;
  };
  laborAllocation: Partial<Record<LaborCategory, number>>;
  /** Optional until historical estimates support a defensible conversion. */
  laborHoursPerMillion?: number;
  notes?: string;
}
export interface CapacityAssumption {
  headcount: number;
  /**
   * Monthly FTE-equivalent of onsite labor the pre-fab shop can offset for
   * this category. Treated as a first source in `analyze()`: it reduces
   * the demand that must be covered by existing staff, hires, subcontract,
   * or overtime, before any of those are counted. Never exceeds a given
   * month's demand (idle shop capacity is not banked into other months).
   */
  prefabCapacity: number;
  productiveHours: number;
  hourlyRate: number;
  overtimeLimit: number;
  recruitDays: number;
  interviewDays: number;
  offerDays: number;
  onboardingDays: number;
  rampDays: number;
  subcontractSourceDays: number;
  subcontractVettingDays: number;
  subcontractMobilizationDays: number;
  leavePercent: number;
  attritionPercent: number;
}
export interface CapacityAction {
  id: string;
  kind: ActionKind;
  category: LaborCategory;
  quantity: number;
  fromIndex: number;
  toIndex: number;
  status: string;
  confirmed: boolean;
  notes: string;
  sourceType?: 'External' | 'Another Department' | 'Undetermined';
  hourlyRate?: number;
  cost?: number;
  costBasis?: 'per hour' | 'per month';
  leadDays?: {
    recruit: number;
    interview: number;
    offer: number;
    onboard: number;
    ramp: number;
    source: number;
    vet: number;
    mobilize: number;
  };
  enableRampCapacity?: boolean;
}
export interface ScenarioConfig {
  probabilities: Record<string, number>;
  included: Record<string, boolean>;
  shifts: Record<string, number>;
  packageIncluded: Record<string, boolean>;
  proposedIncluded: Record<string, boolean>;
  proposedProjects: ProposedProject[];
  actions: CapacityAction[];
  capacity: Record<LaborCategory, CapacityAssumption>;
}
export interface WorkforcePlan {
  id: string;
  name: string;
  status: PlanStatus;
  department: string;
  owner: string;
  description: string;
  sourceDate: string;
  updatedDate: string;
  stale?: boolean;
  config: ScenarioConfig;
}

export interface PlannerDataSource {
  hardBacklogAsOf: string;
  softBacklogAsOf?: string;
  notes?: string;
}

/**
 * Versioned, environment-independent contract served at
 * /data/workforce-planner.json. Month values are ISO YYYY-MM keys; the app
 * derives display labels so the same file works in every browser locale.
 */
export interface PlannerData {
  schemaVersion: 1;
  publishedAt: string;
  forecastStart: string;
  months: string[];
  source: PlannerDataSource;
  departments: string[];
  laborCategories: LaborCategory[];
  categoryFactors: Record<LaborCategory, number>;
  proposedProjectArchetypes: ProposedProjectArchetype[];
  projects: Project[];
  initialPlans: WorkforcePlan[];
}
export interface DemandResult {
  hard: number[];
  expected: number[];
  scenario: number[];
  proposed: number[];
  drivers: Array<Array<{ name: string; type: string; fte: number }>>;
}
export interface CapacityResult {
  /** Onsite demand offset by the pre-fab shop each month — see `CapacityAssumption.prefabCapacity`. */
  prefab: number[];
  existing: number[];
  confirmedHires: number[];
  plannedHires: number[];
  subcontract: number[];
  overtime: number[];
  total: number[];
  gap: number[];
  unconfirmed: number[];
}
export interface AnalysisResult extends DemandResult, CapacityResult {}
