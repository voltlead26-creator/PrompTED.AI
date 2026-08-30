// =====================================================
// PrompTED — Derived field logic
//
// Computed values that templates can surface without asking the user
// to type them (e.g. how long someone held a role, or a budget
// surplus). Pure and unit-tested.
// =====================================================

/** Whole months between two ISO dates (end defaults to today). Never negative. */
export function monthsBetween(startIso: string, endIso?: string): number {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  return Math.max(0, months);
}

/** A friendly duration like "2 years 3 months" from a month count. */
export function formatDuration(months: number): string {
  if (months <= 0) return "less than a month";
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (rem > 0) parts.push(`${rem} month${rem === 1 ? "" : "s"}`);
  return parts.join(" ");
}

export interface BudgetInputs {
  income_salary?: number;
  income_other?: number;
  expense_housing?: number;
  expense_living?: number;
  savings_monthly?: number;
  debt_repayment?: number;
}

export interface BudgetSummary {
  totalIncome: number;
  totalOutgoings: number;
  surplus: number;
  savingsRate: number;
}

/** Compute the headline figures for the Budget Workbook template. */
export function summariseBudget(inputs: BudgetInputs): BudgetSummary {
  const n = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);
  const totalIncome = n(inputs.income_salary) + n(inputs.income_other);
  const totalOutgoings =
    n(inputs.expense_housing) +
    n(inputs.expense_living) +
    n(inputs.savings_monthly) +
    n(inputs.debt_repayment);
  const surplus = totalIncome - totalOutgoings;
  const savingsRate =
    totalIncome > 0
      ? Math.round((n(inputs.savings_monthly) / totalIncome) * 100)
      : 0;
  return { totalIncome, totalOutgoings, surplus, savingsRate };
}
