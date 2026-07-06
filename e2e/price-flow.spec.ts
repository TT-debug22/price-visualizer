import { expect, test, type APIResponse } from "@playwright/test";
import { calculatePriceMetrics } from "../src/domain/price-analytics";
import { evaluateCurrentPrice } from "../src/domain/price-evaluation";
import type { PriceAppState } from "../src/domain/price-types";

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as T;
}

test("価格記録から底値再計算まで確認できる", async ({ request }) => {
  await request.post("/api/test/reset");

  let state = await json<PriceAppState>(
    await request.post("/api/products", {
      data: {
        name: "E2Eカメラ",
        category: "カメラ",
        storeName: "テストストア",
        listedPrice: 30000,
        shippingFee: 0,
        discountAmount: 0,
        couponDiscount: 0,
        pointValue: 0
      }
    })
  );
  const product = state.products.find((item) => item.name === "E2Eカメラ")!;
  expect(product.offers[0].storeName).toBe("テストストア");

  let recordResult = await json<{ state: PriceAppState }>(
    await request.post(`/api/products/${product.id}/record-price`, {
      data: {
        offerId: product.offers[0].id,
        listedPrice: 30000,
        shippingFee: 0,
        discountAmount: 0,
        couponDiscount: 0,
        pointValue: 0,
        recordSource: "manual",
        forceManual: true
      }
    })
  );
  state = recordResult.state;
  expect(state.histories.filter((history) => history.productId === product.id)).toHaveLength(1);

  recordResult = await json<{ state: PriceAppState }>(
    await request.post(`/api/products/${product.id}/record-price`, {
      data: {
        offerId: product.offers[0].id,
        listedPrice: 25000,
        shippingFee: 0,
        discountAmount: 0,
        couponDiscount: 0,
        pointValue: 0,
        recordSource: "manual",
        forceManual: true
      }
    })
  );
  state = recordResult.state;
  const productAfterDrop = state.products.find((item) => item.id === product.id)!;
  const historiesAfterDrop = state.histories.filter((history) => history.productId === product.id);
  expect(historiesAfterDrop).toHaveLength(2);
  expect(calculatePriceMetrics(productAfterDrop, state.histories, state.settings).allTimeLowestEffective?.effectivePrice).toBe(25000);

  state = await json<PriceAppState>(
    await request.patch(`/api/products/${product.id}`, {
      data: {
        targetPrice: 26000
      }
    })
  );
  const productWithTarget = state.products.find((item) => item.id === product.id)!;
  expect(calculatePriceMetrics(productWithTarget, state.histories, state.settings).targetDiff).toBe(-1000);
  expect(evaluateCurrentPrice(productWithTarget, state.histories, state.settings).kind).toBe("insufficient_history");
  expect(calculatePriceMetrics(productWithTarget, state.histories, state.settings).previousChange.amount).toBe(-5000);

  const purchaseResult = await json<{ state: PriceAppState; message: string }>(
    await request.post(`/api/products/${product.id}/purchase`, {
      data: {
        amount: 25000,
        occurredOn: "2026-07-06",
        category: "カメラ",
        note: "E2E購入"
      }
    })
  );
  state = purchaseResult.state;
  expect(purchaseResult.message).toContain("家計簿");
  expect(state.products.find((item) => item.id === product.id)?.wishlistStatus).toBe("purchased");
  expect(state.ledgerEntries.some((entry) => entry.productId === product.id && entry.amount === 25000)).toBe(true);

  const freshSessionState = await json<PriceAppState>(await request.get("/api/state"));
  expect(freshSessionState.products.some((item) => item.name === "E2Eカメラ")).toBe(true);
  expect(freshSessionState.ledgerEntries.some((entry) => entry.productId === product.id && entry.note === "E2E購入")).toBe(true);

  const lowHistory = freshSessionState.histories.find((history) => history.productId === product.id && history.effectivePrice === 25000)!;
  state = await json<PriceAppState>(
    await request.patch(`/api/products/${product.id}/histories/${lowHistory.id}`, {
      data: {
        isExcludedFromLowestPrice: true,
        exclusionReason: "E2Eで除外"
      }
    })
  );
  const productAfterExclusion = state.products.find((item) => item.id === product.id)!;
  expect(calculatePriceMetrics(productAfterExclusion, state.histories, state.settings).allTimeLowestEffective?.effectivePrice).toBe(30000);
});
