import type { Product } from "./price-types";

export function candidateRankScope(product: Pick<Product, "category" | "detailCategory">): string {
  return product.detailCategory?.trim() || product.category.trim() || "未分類";
}

export function normalizeCandidateRanks(products: Product[]): Product[] {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const key = `${product.userId}:${candidateRankScope(product)}`;
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }

  const normalized = new Map<string, Product>();
  for (const group of groups.values()) {
    [...group]
      .sort((a, b) => {
        if (a.candidateRank !== b.candidateRank) return a.candidateRank - b.candidateRank;
        const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        if (updatedDiff !== 0) return updatedDiff;
        const createdDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (createdDiff !== 0) return createdDiff;
        return a.id.localeCompare(b.id);
      })
      .forEach((product, index) => {
        normalized.set(product.id, { ...product, candidateRank: index + 1 });
      });
  }

  return products.map((product) => normalized.get(product.id) ?? product);
}
