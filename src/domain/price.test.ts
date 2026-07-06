import { describe, expect, it } from "vitest";
import type { PriceHistory } from "./price-types";
import { DEFAULT_PRICE_SETTINGS } from "./price-types";
import { createInitialState } from "./fixtures";
import { calculateChange, determineCurrentOffer, offerToSnapshot } from "./price-calculations";
import { historyToSnapshot, shouldCreatePriceHistory } from "./price-history";
import {
  averagePrice,
  buildChartData,
  calculatePriceMetrics,
  filterByPeriod,
  getHighestHistory,
  getLowestHistory,
  isHistoryEligibleForLowest,
  isNearLowestPrice,
  priceDifference,
  productHistories,
  representativeHistory,
  validLowestHistories
} from "./price-analytics";
import { evaluateCurrentPrice } from "./price-evaluation";
import { calculateBudgetSummary, groupProductsByCategory, selectedBudgetProducts, wishlistPrice } from "./wishlist";

const NOW = new Date("2026-07-05T04:00:00.000Z");

function state() {
  return createInitialState();
}

describe("価格ドメインロジック", () => {
  it("過去最安値を計算する", () => {
    const app = state();
    const histories = productHistories(app.histories, "product-headphones");
    expect(getLowestHistory(histories, "effectivePrice")?.effectivePrice).toBe(21800);
  });

  it("除外履歴を底値計算に含めない", () => {
    const app = state();
    const histories = productHistories(app.histories, "product-headphones");
    expect(histories.find((history) => history.id === "history-hp-4")?.effectivePrice).toBe(21000);
    expect(getLowestHistory(histories, "effectivePrice")?.id).toBe("history-hp-5");
  });

  it("30日最安値を計算する", () => {
    const app = state();
    const metrics = calculatePriceMetrics(app.products[0], app.histories, app.settings, NOW);
    expect(metrics.lowest30Days?.effectivePrice).toBe(21800);
  });

  it("90日最安値を計算する", () => {
    const app = state();
    const metrics = calculatePriceMetrics(app.products[0], app.histories, app.settings, NOW);
    expect(metrics.lowest90Days?.effectivePrice).toBe(21800);
  });

  it("期間内平均価格を計算する", () => {
    const app = state();
    const histories = filterByPeriod(validLowestHistories(productHistories(app.histories, "product-headphones")), NOW, "90d");
    expect(averagePrice(histories, "effectivePrice")).toBe(24310);
  });

  it("過去最高価格を計算する", () => {
    const app = state();
    expect(getHighestHistory(productHistories(app.histories, "product-headphones"), "effectivePrice")?.effectivePrice).toBe(27600);
  });

  it("現在価格と過去最安値の差額を計算する", () => {
    const app = state();
    const product = app.products[0];
    product.offers[0].effectivePrice = 22300;
    const metrics = calculatePriceMetrics(product, app.histories, app.settings, NOW);
    expect(priceDifference(metrics.currentEffectivePrice, metrics.allTimeLowestEffective?.effectivePrice ?? null).amount).toBe(500);
  });

  it("現在価格と過去最安値の差率を計算する", () => {
    const diff = priceDifference(22890, 21800);
    expect(diff.rate).toBeCloseTo(5);
  });

  it("最安圏内を判定する", () => {
    expect(isNearLowestPrice(22300, 21800, DEFAULT_PRICE_SETTINGS)).toBe(true);
    expect(isNearLowestPrice(23200, 21800, DEFAULT_PRICE_SETTINGS)).toBe(false);
  });

  it("目標価格以下を判定する", () => {
    const app = state();
    const monitor = app.products.find((product) => product.id === "product-monitor")!;
    const metrics = calculatePriceMetrics(monitor, app.histories, app.settings, NOW);
    expect(metrics.targetDiff).toBeLessThanOrEqual(0);
  });

  it("ユーザー設定底値以下を判定する", () => {
    const app = state();
    const monitor = app.products.find((product) => product.id === "product-monitor")!;
    const metrics = calculatePriceMetrics(monitor, app.histories, app.settings, NOW);
    expect(metrics.customFloorDiff).toBeLessThanOrEqual(0);
  });

  it("値上がり額と値下がり額を計算する", () => {
    expect(calculateChange(38600, 45700).amount).toBe(-7100);
    expect(calculateChange(45700, 38600).amount).toBe(7100);
  });

  it("変動率を計算する", () => {
    expect(calculateChange(38600, 45700).rate).toBeCloseTo(-15.536);
  });

  it("履歴不足を判定する", () => {
    const app = state();
    const coffee = app.products.find((product) => product.id === "product-coffee")!;
    expect(evaluateCurrentPrice(coffee, app.histories, app.settings, NOW).kind).toBe("insufficient_history");
  });

  it("同一価格の自動重複履歴を防止する", () => {
    const app = state();
    const history = app.histories.find((item) => item.id === "history-hp-5")!;
    const decision = shouldCreatePriceHistory(history, historyToSnapshot(history), { isManualRecord: false });
    expect(decision.shouldCreate).toBe(false);
  });

  it("手動記録時は同一価格でも保存する", () => {
    const app = state();
    const history = app.histories.find((item) => item.id === "history-hp-5")!;
    const decision = shouldCreatePriceHistory(history, historyToSnapshot(history), { isManualRecord: true });
    expect(decision.shouldCreate).toBe(true);
  });

  it("在庫切れ履歴を除外できる", () => {
    const app = state();
    const stockOut = app.histories.find((item) => item.id === "history-hp-4")!;
    expect(isHistoryEligibleForLowest(stockOut)).toBe(false);
  });

  it("日単位の代表価格を計算する", () => {
    const records: PriceHistory[] = [
      { ...state().histories[0], id: "same-day-1", effectivePrice: 12000, recordedAt: "2026-07-01T01:00:00.000Z" },
      { ...state().histories[0], id: "same-day-2", effectivePrice: 11000, recordedAt: "2026-07-01T03:00:00.000Z" },
      { ...state().histories[0], id: "same-day-3", effectivePrice: 13000, recordedAt: "2026-07-01T05:00:00.000Z" }
    ];
    expect(representativeHistory(records, "last").id).toBe("same-day-3");
    expect(representativeHistory(records, "lowest").id).toBe("same-day-2");
  });

  it("表示価格と実質価格を切り替えられるグラフデータを作る", () => {
    const app = state();
    const product = app.products[0];
    const data = buildChartData(product, app.histories, {
      period: "all",
      priceType: "both",
      storeViewMode: "overall-lowest",
      selectedStores: [],
      dailyRepresentativeMode: "last",
      now: NOW
    });
    expect(data.at(-1)?.listedPrice).toBe(24800);
    expect(data.at(-1)?.effectivePrice).toBe(21800);
  });

  it("固定された計算対象の出品情報から現在価格を取得する", () => {
    const app = state();
    const product = app.products[0];
    expect(determineCurrentOffer(product)?.id).toBe("offer-headphones-a");
    expect(offerToSnapshot(determineCurrentOffer(product)!).effectivePrice).toBe(21800);
  });

  it("購入予定商品の合計を計算する", () => {
    const app = state();
    const summary = calculateBudgetSummary(app, "planned");
    expect(summary.itemCount).toBe(2);
    expect(summary.total).toBe(26300);
    expect(selectedBudgetProducts(app.products, "planned").map((product) => product.id)).toEqual(["product-headphones", "product-coffee"]);
  });

  it("月次予算では対象月の購入予定だけを合計する", () => {
    const app = state();
    app.settings.budgetPeriod = "monthly";
    app.products.find((product) => product.id === "product-coffee")!.plannedPurchaseMonth = "2026-08";
    const summary = calculateBudgetSummary(app, "planned", NOW);

    expect(summary.periodLabel).toBe("2026年7月");
    expect(summary.itemCount).toBe(1);
    expect(summary.periodExcludedCount).toBe(1);
    expect(summary.total).toBe(21800);
  });

  it("価格未設定は予算合計から除外し、0円は価格ありとして扱う", () => {
    const app = state();
    const base = app.products[0];
    const unsetProduct = {
      ...base,
      id: "product-unset",
      name: "価格未設定の商品",
      candidateRank: 3,
      offers: [
        {
          ...base.offers[0],
          id: "offer-unset",
          productId: "product-unset",
          listedPrice: null,
          effectivePrice: null
        }
      ],
      calculationOfferId: "offer-unset"
    };
    const zeroPriceProduct = {
      ...base,
      id: "product-free",
      name: "0円の商品",
      candidateRank: 4,
      offers: [
        {
          ...base.offers[0],
          id: "offer-free",
          productId: "product-free",
          listedPrice: 0,
          effectivePrice: 0
        }
      ],
      calculationOfferId: "offer-free"
    };

    app.products = [...app.products, unsetProduct, zeroPriceProduct];
    const summary = calculateBudgetSummary(app, "planned");

    expect(wishlistPrice(unsetProduct)).toBeNull();
    expect(wishlistPrice(zeroPriceProduct)).toBe(0);
    expect(summary.total).toBe(26300);
    expect(summary.itemCount).toBe(4);
    expect(summary.pricedItemCount).toBe(3);
    expect(summary.unsetPriceCount).toBe(1);
  });

  it("第一候補商品の合計を計算する", () => {
    const app = state();
    const summary = calculateBudgetSummary(app, "primary");
    expect(summary.itemCount).toBe(2);
    expect(summary.total).toBe(60400);
    expect(selectedBudgetProducts(app.products, "primary").map((product) => product.id)).toEqual(["product-headphones", "product-monitor"]);
  });

  it("詳細ジャンルごとに候補を並べる", () => {
    const app = state();
    const categories = groupProductsByCategory(app.products);
    expect(categories.map((category) => category.category)).toContain("オーディオ");
    expect(categories.find((category) => category.category === "モニター")?.primaryTotal).toBe(38600);
  });
});
