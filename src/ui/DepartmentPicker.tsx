import {
  departmentColor,
  departmentDivision,
  departmentShortLabel,
  selectedDepartments,
  type DepartmentMode,
  type DepartmentSelectionState,
} from './departmentSelection';

const MODES: [DepartmentMode, string][] = [
  ['single', 'Single'],
  ['compare', 'Compare'],
  ['combine', 'Combine'],
];

const MODE_NOTE: Record<DepartmentMode, string> = {
  single: 'One department at a time.',
  compare:
    'One full panel per selected department, each scoped to its own backlog and roster.',
  combine:
    "Selected departments are pooled into one demand and capacity view. Capacity above a department's own demand is not counted.",
};

export function departmentPickerLabel(s: DepartmentSelectionState): string {
  if (s.deptMode === 'single') return departmentShortLabel(s.department);
  const list = selectedDepartments(s);
  return `${list.length} departments`;
}

export function departmentPickerSubline(
  s: DepartmentSelectionState,
  projectCount: (department: string) => number,
): string {
  if (s.deptMode === 'single') {
    const n = projectCount(s.department);
    return n
      ? `${n} ${n === 1 ? 'project' : 'projects'} in plan`
      : 'No published export loaded yet';
  }
  const list = selectedDepartments(s);
  return `${list.length} departments · ${s.deptMode === 'compare' ? 'compared side by side' : 'pooled into one view'}`;
}

export function DepartmentPicker({
  departments,
  selection,
  toggle,
  promote,
  setMode,
  projectCount,
}: {
  departments: string[];
  selection: DepartmentSelectionState;
  toggle: (department: string) => void;
  promote: (department: string) => void;
  setMode: (mode: DepartmentMode) => void;
  projectCount: (department: string) => number;
}) {
  const list = selectedDepartments(selection);
  const multi = selection.deptMode !== 'single';
  const division = departmentDivision(departments);
  return (
    <div className="field dept-picker-field">
      <span className="field-label">DEPARTMENT</span>
      <details className="dept-picker">
        <summary
          aria-label={`Department: ${departmentPickerLabel(selection)}. ${departmentPickerSubline(selection, projectCount)}`}
        >
          <span
            className="dept-picker-dot"
            style={{ background: departmentColor(0) }}
            aria-hidden="true"
          />
          <span className="dept-picker-trigger-text">
            <span className="dept-picker-name">
              {departmentPickerLabel(selection)}
            </span>
            <small>{departmentPickerSubline(selection, projectCount)}</small>
          </span>
        </summary>
        <div className="dept-picker-panel">
          <div className="dept-picker-mode">
            <span className="field-label">DEPARTMENT VIEW</span>
            <div
              className="overlap-toggle"
              role="group"
              aria-label="Department view mode"
            >
              {MODES.map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={selection.deptMode === mode ? 'on' : ''}
                  onClick={() => setMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="dept-picker-mode-note">
              {MODE_NOTE[selection.deptMode]}
            </p>
          </div>
          <div className="dept-picker-header">
            <span>{division ? `${division} DEPARTMENTS` : 'DEPARTMENTS'}</span>
            <span>PROJECTS IN PLAN</span>
          </div>
          <div className="dept-picker-body">
            {departments.map((department) => {
              const n = projectCount(department);
              const isLead = department === selection.department;
              const isSelected = list.includes(department);
              const on = multi ? isSelected : isLead;
              return (
                <label
                  key={department}
                  className={`dept-picker-row${isLead ? ' dept-picker-row-lead' : ''}`}
                >
                  {multi ? (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isSelected && list.length === 1}
                      onChange={() => toggle(department)}
                    />
                  ) : (
                    <input
                      type="radio"
                      name="dept-picker-single"
                      checked={isLead}
                      onChange={() => toggle(department)}
                    />
                  )}
                  <span
                    className="dept-picker-dot"
                    style={{
                      background: on
                        ? departmentColor(list.indexOf(department))
                        : n
                          ? '#C9C7C2'
                          : '#EFEEEC',
                    }}
                    aria-hidden="true"
                  />
                  <span className="dept-picker-row-text">
                    <span className={isLead ? 'dept-picker-name-bold' : ''}>
                      {departmentShortLabel(department)}
                    </span>
                    <small>
                      {isLead
                        ? multi
                          ? `Lead department · ${n} ${n === 1 ? 'project' : 'projects'}`
                          : 'Selected · hard and soft backlog published'
                        : isSelected
                          ? `In the comparison · ${n} ${n === 1 ? 'project' : 'projects'}`
                          : n
                            ? `${n} ${n === 1 ? 'project' : 'projects'} published`
                            : 'No published export loaded yet'}
                    </small>
                  </span>
                  <span className="dept-picker-row-count">{n || '—'}</span>
                  {multi && isSelected && !isLead && (
                    <button
                      type="button"
                      className="dept-picker-set"
                      onClick={() => promote(department)}
                    >
                      SET
                    </button>
                  )}
                  {multi && isLead && (
                    <span className="dept-picker-lead-badge">LEAD</span>
                  )}
                </label>
              );
            })}
          </div>
          <p className="dept-picker-footer">
            Capacity belongs to its department; no interdepartmental transfers
            are modeled.
          </p>
        </div>
      </details>
    </div>
  );
}
