import { describe, expect, it } from 'vitest';
import {
  changeDeptMode,
  departmentColor,
  departmentDivision,
  departmentShortLabel,
  promoteDepartment,
  selectedDepartments,
  toggleDepartment,
  type DepartmentSelectionState,
} from './departmentSelection';

const ALL = [
  'Mechanical - DFW - Projects',
  'Mechanical - Florida - Special Projects',
  'Mechanical - Greenwood - Projects',
  'Mechanical - National - Special Projects',
];

describe('departmentShortLabel / departmentDivision', () => {
  it('strips the shared division prefix, joined with a middot', () => {
    expect(departmentShortLabel('Mechanical - DFW - Projects')).toBe(
      'DFW · Projects',
    );
  });

  it('leaves a department with no division prefix untouched', () => {
    expect(departmentShortLabel('Standalone Department')).toBe(
      'Standalone Department',
    );
  });

  it('reads the division from the first department in the list', () => {
    expect(departmentDivision(ALL)).toBe('Mechanical');
    expect(departmentDivision([])).toBe('');
  });
});

describe('departmentColor', () => {
  it('is stable and wraps around the four-color palette', () => {
    expect(departmentColor(0)).toBe(departmentColor(0));
    expect(departmentColor(0)).toBe(departmentColor(4));
  });
});

describe('selectedDepartments', () => {
  it('is just the lead in single mode, regardless of cmpDeptList', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [ALL[1], ALL[2]],
      deptMode: 'single',
    };
    expect(selectedDepartments(s)).toEqual([ALL[0]]);
  });

  it('puts the lead first, deduped against cmpDeptList, in compare/combine', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [ALL[1], ALL[0], ALL[2]],
      deptMode: 'compare',
    };
    expect(selectedDepartments(s)).toEqual([ALL[0], ALL[1], ALL[2]]);
  });
});

describe('toggleDepartment', () => {
  it('single mode: toggling any row just selects it', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [],
      deptMode: 'single',
    };
    expect(toggleDepartment(s, ALL[2])).toEqual({
      department: ALL[2],
      cmpDeptList: [],
    });
  });

  it('appends an unselected department in compare mode', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [ALL[1]],
      deptMode: 'compare',
    };
    expect(toggleDepartment(s, ALL[2])).toEqual({
      department: ALL[0],
      cmpDeptList: [ALL[1], ALL[2]],
    });
  });

  it('removes a selected non-lead department', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [ALL[1], ALL[2]],
      deptMode: 'compare',
    };
    expect(toggleDepartment(s, ALL[1])).toEqual({
      department: ALL[0],
      cmpDeptList: [ALL[2]],
    });
  });

  it('promotes the next selected department when the lead is toggled off', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [ALL[1], ALL[2]],
      deptMode: 'compare',
    };
    expect(toggleDepartment(s, ALL[0])).toEqual({
      department: ALL[1],
      cmpDeptList: [ALL[2]],
    });
  });

  it('never allows zero departments — toggling the sole lead is a no-op', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [],
      deptMode: 'compare',
    };
    expect(toggleDepartment(s, ALL[0])).toEqual({
      department: ALL[0],
      cmpDeptList: [],
    });
  });
});

describe('promoteDepartment', () => {
  it('makes the target the lead and keeps the former lead in the comparison set', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [ALL[1], ALL[2]],
      deptMode: 'compare',
    };
    expect(promoteDepartment(s, ALL[2])).toEqual({
      department: ALL[2],
      cmpDeptList: [ALL[0], ALL[1]],
    });
  });
});

describe('changeDeptMode', () => {
  it('auto-adds the next department when leaving Single with only one selected', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [],
      deptMode: 'single',
    };
    expect(changeDeptMode(s, 'compare', ALL)).toEqual({
      deptMode: 'compare',
      cmpDeptList: [ALL[1]],
    });
  });

  it('leaves the comparison list untouched when already 2+ are selected', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [ALL[2]],
      deptMode: 'compare',
    };
    expect(changeDeptMode(s, 'combine', ALL)).toEqual({
      deptMode: 'combine',
      cmpDeptList: [ALL[2]],
    });
  });

  it('switching back to single leaves cmpDeptList untouched (selectedDepartments ignores it)', () => {
    const s: DepartmentSelectionState = {
      department: ALL[0],
      cmpDeptList: [ALL[1]],
      deptMode: 'compare',
    };
    expect(changeDeptMode(s, 'single', ALL)).toEqual({
      deptMode: 'single',
      cmpDeptList: [ALL[1]],
    });
  });
});
