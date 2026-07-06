import type { LedgerEntry } from "./price-types";

export interface LedgerCategorySummary {
  category: string;
  amount: number;
  count: number;
}

export interface LedgerMonthSummary {
  month: string;
  entries: LedgerEntry[];
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
  budget: number;
  budgetRemaining: number;
  isOverBudget: boolean;
  expenseCount: number;
  incomeCount: number;
  categorySummaries: LedgerCategorySummary[];
}

export interface LedgerTrendPoint {
  month: string;
  label: string;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
}

export function ledgerMonthKey(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 7);
  return value.slice(0, 7);
}

export function ledgerMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-");
  return `${Number(year)}年${Number(monthNumber)}月`;
}

export function defaultLedgerDate(month: string, now: Date = new Date()): string {
  const currentMonth = ledgerMonthKey(now);
  if (month === currentMonth) return now.toISOString().slice(0, 10);
  return `${month}-01`;
}

export function buildLedgerMonthSummary(entries: LedgerEntry[], month: string, budget: number): LedgerMonthSummary {
  const monthEntries = entries
    .filter((entry) => ledgerMonthKey(entry.occurredOn) === month)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt));
  const incomeTotal = monthEntries.filter((entry) => entry.entryType === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const expenseEntries = monthEntries.filter((entry) => entry.entryType === "expense");
  const expenseTotal = expenseEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const categoryMap = new Map<string, { amount: number; count: number }>();

  for (const entry of expenseEntries) {
    const current = categoryMap.get(entry.category) ?? { amount: 0, count: 0 };
    categoryMap.set(entry.category, { amount: current.amount + entry.amount, count: current.count + 1 });
  }

  return {
    month,
    entries: monthEntries,
    incomeTotal,
    expenseTotal,
    balance: incomeTotal - expenseTotal,
    budget,
    budgetRemaining: budget - expenseTotal,
    isOverBudget: expenseTotal > budget,
    expenseCount: expenseEntries.length,
    incomeCount: monthEntries.length - expenseEntries.length,
    categorySummaries: Array.from(categoryMap.entries())
      .map(([category, value]) => ({ category, amount: value.amount, count: value.count }))
      .sort((a, b) => b.amount - a.amount)
  };
}

function addMonths(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

export function buildLedgerTrend(entries: LedgerEntry[], anchorMonth: string, monthCount = 6): LedgerTrendPoint[] {
  return Array.from({ length: monthCount }, (_, index) => addMonths(anchorMonth, index - monthCount + 1)).map((month) => {
    const summary = buildLedgerMonthSummary(entries, month, 0);
    const [, monthNumber] = month.split("-");
    return {
      month,
      label: `${Number(monthNumber)}月`,
      incomeTotal: summary.incomeTotal,
      expenseTotal: summary.expenseTotal,
      balance: summary.balance
    };
  });
}
