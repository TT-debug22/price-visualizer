import { describe, expect, it } from "vitest";
import { buildLedgerMonthSummary, buildLedgerTrend } from "./ledger";
import type { LedgerEntry } from "./price-types";

const entries: LedgerEntry[] = [
  {
    id: "income",
    userId: "user",
    productId: null,
    title: "給与",
    amount: 300000,
    entryType: "income",
    category: "給与",
    occurredOn: "2026-07-01",
    note: null,
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "food",
    userId: "user",
    productId: null,
    title: "スーパー",
    amount: 8000,
    entryType: "expense",
    category: "食費",
    occurredOn: "2026-07-02",
    note: null,
    createdAt: "2026-07-02T00:00:00.000Z"
  },
  {
    id: "daily",
    userId: "user",
    productId: null,
    title: "洗剤",
    amount: 2000,
    entryType: "expense",
    category: "日用品",
    occurredOn: "2026-07-03",
    note: null,
    createdAt: "2026-07-03T00:00:00.000Z"
  },
  {
    id: "previous",
    userId: "user",
    productId: null,
    title: "交通費",
    amount: 1500,
    entryType: "expense",
    category: "交通",
    occurredOn: "2026-06-30",
    note: null,
    createdAt: "2026-06-30T00:00:00.000Z"
  }
];

describe("ledger", () => {
  it("月別の収入・支出・予算残高を計算する", () => {
    const summary = buildLedgerMonthSummary(entries, "2026-07", 12000);
    expect(summary.incomeTotal).toBe(300000);
    expect(summary.expenseTotal).toBe(10000);
    expect(summary.balance).toBe(290000);
    expect(summary.budgetRemaining).toBe(2000);
    expect(summary.isOverBudget).toBe(false);
    expect(summary.categorySummaries).toEqual([
      { category: "食費", amount: 8000, count: 1 },
      { category: "日用品", amount: 2000, count: 1 }
    ]);
  });

  it("月別推移を古い月から並べる", () => {
    const trend = buildLedgerTrend(entries, "2026-07", 2);
    expect(trend.map((point) => point.month)).toEqual(["2026-06", "2026-07"]);
    expect(trend[0].expenseTotal).toBe(1500);
    expect(trend[1].incomeTotal).toBe(300000);
  });
});
