export type Unit = 'People' | 'Hours' | 'Labor Cost';
export type PlanStatus =
  | 'Draft'
  | 'Under Review'
  | 'Approved Operating Plan'
  | 'Superseded'
  | 'Archived';
export type LaborCategory =
  | 'Project Manager'
  | 'Project Engineer'
  | 'Superintendent'
  | 'Foreman'
  | 'Plumber'
  | 'Pipefitter'
  | 'Sheet-Metal Worker'
  | 'Welder'
  | 'HVAC Mechanic'
  | 'Electrician'
  | 'Electrical Apprentice'
  | 'Plumbing Apprentice'
  | 'Controls Technician'
  | 'BIM/VDC Specialist'
  | 'Project Coordinator';
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
}
export interface Project {
  id: string;
  name: string;
  department: string;
  type: 'Hard' | 'Soft';
  value: number;
  planningProbability: number;
  sourceProbability: number;
  startIndex: number;
  curve: number[];
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
}
export interface ProposedProject {
  id: string;
  name: string;
  department: string;
  projectType: string;
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
export interface CapacityAssumption {
  headcount: number;
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
  proposedIncluded: boolean;
  proposed: ProposedProject;
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
export interface DemandResult {
  hard: number[];
  expected: number[];
  scenario: number[];
  proposed: number[];
  drivers: Array<Array<{ name: string; type: string; fte: number }>>;
}
export interface CapacityResult {
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
