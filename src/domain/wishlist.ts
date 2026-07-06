import type { BudgetViewMode, PriceAppState, Product } from "./price-types";
import { determineCurrentOffer } from "./price-calculations";

export interface BudgetSummary {
  mode: BudgetViewMode;
  budget: number;
  total: number;
  remaining: number;
  isOverBudget: boolean;
  itemCount: number;
  products: Product[];
}

export interface CategorySummary {
  category: string;
  plannedTotal: number;
  primaryTotal: number;
  plannedCount: number;
  primaryCount: number;
  products: Product[];
}

export function wishlistPrice(product: Product): number {
  const offer = determineCurrentOffer(product);
  return offer?.effectivePrice ?? offer?.listedPrice ?? 0;
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

export function calculateBudgetSummary(state: PriceAppState, mode: BudgetViewMode): BudgetSummary {
  const products = selectedBudgetProducts(state.products, mode);
  const total = products.reduce((sum, product) => sum + wishlistPrice(product), 0);
  const budget = state.settings.wishlistBudget;
  return {
    mode,
    budget,
    total,
    remaining: budget - total,
    isOverBudget: total > budget,
    itemCount: products.length,
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
        return wishlistPrice(a) - wishlistPrice(b);
      });
      const planned = selectedBudgetProducts(sorted, "planned");
      const primary = selectedBudgetProducts(sorted, "primary");
      return {
        category,
        products: sorted,
        plannedTotal: planned.reduce((sum, product) => sum + wishlistPrice(product), 0),
        primaryTotal: primary.reduce((sum, product) => sum + wishlistPrice(product), 0),
        plannedCount: planned.length,
        primaryCount: primary.length
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category, "ja"));
}

export function budgetEvidence(summary: BudgetSummary): string {
  if (summary.itemCount === 0) return "対象商品がまだありません。";
  if (summary.isOverBudget) return `予算を${Math.abs(summary.remaining).toLocaleString("ja-JP")}円超過しています。`;
  return `予算内です。残り${summary.remaining.toLocaleString("ja-JP")}円です。`;
}
