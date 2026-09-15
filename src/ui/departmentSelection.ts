export type DepartmentMode = 'single' | 'compare' | 'combine';

export interface DepartmentSelectionState {
  /** The lead department — the one Single mode shows and Compare/Combine
   * fall back to for tiles, the timeline and recommendations. */
  department: string;
  /** Additional departments in Compare/Combine, in the order added. Never
   * contains `department`. */
  cmpDeptList: string[];
  deptMode: DepartmentMode;
}

const DEPARTMENT_COLORS = ['#161514', '#0068CC', '#B8740B', '#007A3D'];

export function departmentColor(index: number): string {
  return DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length];
}

/** "Mechanical - DFW - Projects" -> "DFW · Projects" — the department minus
 * the shared division prefix, which the panel header states once instead. */
export function departmentShortLabel(department: string): string {
  const parts = department.split(' - ');
  return parts.length > 1 ? parts.slice(1).join(' · ') : department;
}

export function departmentDivision(departments: string[]): string {
  return departments.length ? departments[0].split(' - ')[0] : '';
}

/** Lead first, then the comparison list (deduped against the lead), in
 * Single mode just the lead alone. Every consumer should read this rather
 * than `cmpDeptList` directly. */
export function selectedDepartments(s: DepartmentSelectionState): string[] {
  if (s.deptMode === 'single') return [s.department];
  return [s.department, ...s.cmpDeptList.filter((d) => d !== s.department)];
}

/**
 * Toggling a department row. Single mode is a plain single-select. In
 * Compare/Combine: toggling an unselected department appends it; toggling a
 * selected non-lead department removes it; toggling the lead promotes the
 * next selected department to lead (a no-op if it is the only one selected —
 * zero departments is never a valid state).
 */
export function toggleDepartment(
  s: DepartmentSelectionState,
  department: string,
): Pick<DepartmentSelectionState, 'department' | 'cmpDeptList'> {
  if (s.deptMode === 'single')
    return { department, cmpDeptList: s.cmpDeptList };
  const current = selectedDepartments(s);
  if (!current.includes(department))
    return {
      department: s.department,
      cmpDeptList: [...s.cmpDeptList, department],
    };
  if (department !== s.department)
    return {
      department: s.department,
      cmpDeptList: s.cmpDeptList.filter((d) => d !== department),
    };
  const rest = current.filter((d) => d !== department);
  if (!rest.length)
    return { department: s.department, cmpDeptList: s.cmpDeptList };
  const [nextLead, ...nextExtras] = rest;
  return { department: nextLead, cmpDeptList: nextExtras };
}

/** The `SET` action — makes `department` the lead, keeping the rest of the
 * selection (the former lead stays in the comparison set). */
export function promoteDepartment(
  s: DepartmentSelectionState,
  department: string,
): Pick<DepartmentSelectionState, 'department' | 'cmpDeptList'> {
  const current = selectedDepartments(s);
  return { department, cmpDeptList: current.filter((d) => d !== department) };
}

/**
 * Switching modes. Leaving Single with fewer than two departments selected
 * auto-adds the next available department, so Compare/Combine always has
 * something to show.
 */
export function changeDeptMode(
  s: DepartmentSelectionState,
  mode: DepartmentMode,
  allDepartments: string[],
): Pick<DepartmentSelectionState, 'deptMode' | 'cmpDeptList'> {
  const current = selectedDepartments(s);
  const cmpDeptList =
    mode !== 'single' && current.length < 2
      ? allDepartments.filter((d) => d !== s.department).slice(0, 1)
      : s.cmpDeptList;
  return { deptMode: mode, cmpDeptList };
}
