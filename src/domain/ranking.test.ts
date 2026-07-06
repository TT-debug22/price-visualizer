import { describe, expect, it } from "vitest";
import { createInitialState } from "./fixtures";
import { normalizeCandidateRanks } from "./ranking";

describe("候補順位ロジック", () => {
  it("同じ詳細ジャンル内の候補順位を重複なしに整える", () => {
    const app = createInitialState();
    const base = app.products[0];
    const challenger = {
      ...base,
      id: "product-new-headphones",
      name: "新しいヘッドホン候補",
      candidateRank: 1,
      createdAt: "2026-07-04T09:00:00.000Z",
      updatedAt: "2026-07-06T09:00:00.000Z",
      offers: []
    };

    const normalized = normalizeCandidateRanks([base, challenger]);

    expect(normalized.find((product) => product.id === "product-new-headphones")?.candidateRank).toBe(1);
    expect(normalized.find((product) => product.id === "product-headphones")?.candidateRank).toBe(2);
  });

  it("削除後の候補順位の空きを詰める", () => {
    const app = createInitialState();
    const products = app.products.map((product, index) => ({
      ...product,
      detailCategory: "デスク用品",
      candidateRank: index + 1
    }));

    const normalized = normalizeCandidateRanks(products.filter((product) => product.candidateRank !== 2));

    expect(normalized.map((product) => product.candidateRank)).toEqual([1, 2]);
  });
});
