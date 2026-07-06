import type { BudgetPeriod, BudgetViewMode, PriceAppState, Product } from "./price-types";
import { BUDGET_PERIOD_LABELS } from "./price-types";
import { determineCurrentOffer } from "./price-calculations";

export interface BudgetSummary {
  mode: BudgetViewMode;
  budget: number;
  total: number;
  remaining: number;
  isOverBudget: boolean;
  itemCount: number;
  pricedItemCount: number;
  unsetPriceCount: number;
  budgetPeriod: BudgetPeriod;
  periodLabel: string;
  periodExcludedCount: number;
  products: Product[];
}

export interface CategorySummary {
  category: string;
  plannedTotal: number;
  primaryTotal: number;
  plannedCount: number;
  primaryCount: number;
  plannedUnsetCount: number;
  primaryUnsetCount: number;
  products: Product[];
}

export function wishlistPrice(product: Product): number | null {
  const offer = determineCurrentOffer(product);
  return offer?.effectivePrice ?? offer?.listedPrice ?? null;
}

export function wishlistPriceForSort(product: Product): number {
  return wishlistPrice(product) ?? Number.MAX_SAFE_INTEGER;
}

export function isActiveWishlistProduct(product: Product): boolean {
  return product.wishlistStatus !== "purchased" && product.wishlistStatus !== "rejected";
}

export function selectedBudgetProducts(products: Product[], mode: BudgetViewMode): Product[] {
  if (mode === "planned") {
    return products.filter((product) => product.wishlistStatus === "planned");
  }
  return products.filter((product) => product.candidateRank === 1 && isActiveWishlistProduct(product));
}

function currentMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function currentYearKey(now: Date): string {
  return now.toISOString().slice(0, 4);
}

export function budgetPeriodLabel(period: BudgetPeriod, now: Date): string {
  if (period === "monthly") {
    const [year, month] = currentMonthKey(now).split("-");
    return `${Number(year)}年${Number(month)}月`;
  }
  if (period === "yearly") return `${currentYearKey(now)}年`;
  return BUDGET_PERIOD_LABELS.one_time;
}

export function matchesBudgetPeriod(product: Product, period: BudgetPeriod, now: Date): boolean {
  if (period === "one_time") return true;
  if (!product.plannedPurchaseMonth) return false;
  if (period === "monthly") return product.plannedPurchaseMonth === currentMonthKey(now);
  return product.plannedPurchaseMonth.slice(0, 4) === currentYearKey(now);
}

export function calculateBudgetSummary(state: PriceAppState, mode: BudgetViewMode, now = new Date()): BudgetSummary {
  const budgetPeriod = state.settings.budgetPeriod;
  const baseProducts = selectedBudgetProducts(state.products, mode);
  const products = baseProducts.filter((product) => matchesBudgetPeriod(product, budgetPeriod, now));
  const prices = products.map(wishlistPrice);
  const total = prices.reduce<number>((sum, price) => sum + (price ?? 0), 0);
  const pricedItemCount = prices.filter((price) => price !== null).length;
  const budget = state.settings.wishlistBudget;
  return {
    mode,
    budget,
    total,
    remaining: budget - total,
    isOverBudget: total > budget,
    itemCount: products.length,
    pricedItemCount,
    unsetPriceCount: products.length - pricedItemCount,
    budgetPeriod,
    periodLabel: budgetPeriodLabel(budgetPeriod, now),
    periodExcludedCount: baseProducts.length - products.length,
    products
  };
}

export function groupProductsByCategory(products: Product[]): CategorySummary[] {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const key = product.detailCategory || product.category || "未分類";
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }

  return Array.from(groups.entries())
    .map(([category, items]) => {
      const sorted = [...items].sort((a, b) => {
        if (a.candidateRank !== b.candidateRank) return a.candidateRank - b.candidateRank;
        return wishlistPriceForSort(a) - wishlistPriceForSort(b);
      });
      const planned = selectedBudgetProducts(sorted, "planned");
      const primary = selectedBudgetProducts(sorted, "primary");
      return {
        category,
        products: sorted,
        plannedTotal: planned.reduce<number>((sum, product) => sum + (wishlistPrice(product) ?? 0), 0),
        primaryTotal: primary.reduce<number>((sum, product) => sum + (wishlistPrice(product) ?? 0), 0),
        plannedCount: planned.length,
        primaryCount: primary.length,
        plannedUnsetCount: planned.filter((product) => wishlistPrice(product) === null).length,
        primaryUnsetCount: primary.filter((product) => wishlistPrice(product) === null).length
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category, "ja"));
}

export function budgetEvidence(summary: BudgetSummary): string {
  if (summary.itemCount === 0) {
    if (summary.periodExcludedCount > 0) return `対象期間内の商品がありません。対象期間外の商品${summary.periodExcludedCount}件は含めていません。`;
    return "対象商品がまだありません。";
  }
  const notes = [
    summary.unsetPriceCount > 0 ? `価格未設定${summary.unsetPriceCount}件を除いた暫定判定です。` : "",
    summary.periodExcludedCount > 0 ? `対象期間外の商品${summary.periodExcludedCount}件は含めていません。` : ""
  ].filter(Boolean);
  const suffix = notes.length > 0 ? notes.join("") : "";
  if (summary.isOverBudget) return `予算を${Math.abs(summary.remaining).toLocaleString("ja-JP")}円超過しています。${suffix}`;
  return `予算内です。残り${summary.remaining.toLocaleString("ja-JP")}円です。${suffix}`;
}
