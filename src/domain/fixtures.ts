import type { PriceAppState, PriceHistory, Product } from "./price-types";
import { DEFAULT_PRICE_SETTINGS } from "./price-types";

const USER_ID = "demo-user";
const NOW = "2026-07-05T04:00:00.000Z";

function history(partial: Omit<PriceHistory, "userId" | "createdAt" | "isExcludedFromLowestPrice" | "exclusionReason" | "note"> & Partial<PriceHistory>): PriceHistory {
  return {
    userId: USER_ID,
    isExcludedFromLowestPrice: false,
    exclusionReason: null,
    note: null,
    createdAt: partial.recordedAt,
    ...partial
  };
}

export function createInitialState(): PriceAppState {
  const products: Product[] = [
    {
      id: "product-headphones",
      userId: USER_ID,
      name: "ノイズキャンセリングヘッドホン",
      category: "家電",
      detailCategory: "オーディオ",
      wishlistStatus: "planned",
      priority: "high",
      mustHaveLevel: "must",
      candidateRank: 1,
      productUrl: "https://example.com/headphones",
      imageUrl: null,
      purchaseUrl: "https://example.com/headphones/buy",
      purchaseNote: "通勤用の第一候補",
      plannedPurchaseMonth: "2026-07",
      referencePrice: 32800,
      targetPrice: 23000,
      customFloorPrice: 21500,
      calculationOfferId: "offer-headphones-a",
      createdAt: "2026-03-01T09:00:00.000Z",
      updatedAt: NOW,
      offers: [
        {
          id: "offer-headphones-a",
          productId: "product-headphones",
          storeName: "Tokyo Audio",
          listedPrice: 24800,
          shippingFee: 0,
          discountAmount: 800,
          couponDiscount: 1000,
          pointValue: 1200,
          effectivePrice: 21800,
          stockStatus: "in_stock",
          isCalculationTarget: true,
          updatedAt: NOW,
          sourceType: "manual",
          lastFetchedAt: null,
          nextCheckAt: null,
          fetchStatus: "idle",
          lastFetchError: null,
          autoFetchEnabled: false,
          priceAdapterKey: null
        },
        {
          id: "offer-headphones-b",
          productId: "product-headphones",
          storeName: "Nihon Camera",
          listedPrice: 23980,
          shippingFee: 550,
          discountAmount: 0,
          couponDiscount: 500,
          pointValue: 650,
          effectivePrice: 23380,
          stockStatus: "in_stock",
          isCalculationTarget: false,
          updatedAt: "2026-07-04T08:00:00.000Z",
          sourceType: "manual",
          autoFetchEnabled: false
        },
        {
          id: "offer-headphones-c",
          productId: "product-headphones",
          storeName: "Outlet Garage",
          listedPrice: 19800,
          shippingFee: 1200,
          discountAmount: 0,
          couponDiscount: 0,
          pointValue: 0,
          effectivePrice: 21000,
          stockStatus: "out_of_stock",
          isCalculationTarget: false,
          updatedAt: "2026-06-25T08:00:00.000Z",
          sourceType: "manual",
          autoFetchEnabled: false
        }
      ]
    },
    {
      id: "product-monitor",
      userId: USER_ID,
      name: "27インチ 4K モニター",
      category: "仕事環境",
      detailCategory: "モニター",
      wishlistStatus: "candidate",
      priority: "high",
      mustHaveLevel: "nice",
      candidateRank: 1,
      productUrl: "https://example.com/monitor",
      imageUrl: null,
      purchaseUrl: "https://example.com/monitor/buy",
      purchaseNote: "在宅作業の候補",
      plannedPurchaseMonth: "2026-08",
      referencePrice: 54800,
      targetPrice: 42000,
      customFloorPrice: 39800,
      calculationOfferId: null,
      createdAt: "2026-02-12T09:00:00.000Z",
      updatedAt: NOW,
      offers: [
        {
          id: "offer-monitor-a",
          productId: "product-monitor",
          storeName: "Desk Lab",
          listedPrice: 43800,
          shippingFee: 0,
          discountAmount: 3000,
          couponDiscount: 0,
          pointValue: 2200,
          effectivePrice: 38600,
          stockStatus: "in_stock",
          isCalculationTarget: false,
          updatedAt: NOW,
          sourceType: "manual",
          autoFetchEnabled: false
        },
        {
          id: "offer-monitor-b",
          productId: "product-monitor",
          storeName: "PC Market",
          listedPrice: 41800,
          shippingFee: 800,
          discountAmount: 0,
          couponDiscount: 0,
          pointValue: 800,
          effectivePrice: 41800,
          stockStatus: "in_stock",
          isCalculationTarget: false,
          updatedAt: "2026-07-03T06:00:00.000Z",
          sourceType: "manual",
          autoFetchEnabled: false
        }
      ]
    },
    {
      id: "product-coffee",
      userId: USER_ID,
      name: "浅煎りコーヒー豆 1kg",
      category: "食品",
      detailCategory: "コーヒー豆",
      wishlistStatus: "planned",
      priority: "medium",
      mustHaveLevel: "optional",
      candidateRank: 2,
      productUrl: "https://example.com/coffee",
      imageUrl: null,
      purchaseUrl: "https://example.com/coffee/buy",
      purchaseNote: "消耗品なので予算に余裕があるとき",
      plannedPurchaseMonth: "2026-07",
      referencePrice: 5200,
      targetPrice: 4200,
      customFloorPrice: 3900,
      calculationOfferId: "offer-coffee-a",
      createdAt: "2026-07-01T09:00:00.000Z",
      updatedAt: NOW,
      offers: [
        {
          id: "offer-coffee-a",
          productId: "product-coffee",
          storeName: "Roast House",
          listedPrice: 4600,
          shippingFee: 0,
          discountAmount: 0,
          couponDiscount: 0,
          pointValue: 100,
          effectivePrice: 4500,
          stockStatus: "in_stock",
          isCalculationTarget: true,
          updatedAt: NOW,
          sourceType: "manual",
          autoFetchEnabled: false
        }
      ]
    }
  ];

  const histories: PriceHistory[] = [
    history({
      id: "history-hp-1",
      productId: "product-headphones",
      offerId: "offer-headphones-a",
      storeName: "Tokyo Audio",
      listedPrice: 28800,
      shippingFee: 0,
      discountAmount: 0,
      couponDiscount: 0,
      pointValue: 1200,
      effectivePrice: 27600,
      stockStatus: "in_stock",
      recordedAt: "2026-04-05T04:00:00.000Z",
      recordSource: "manual"
    }),
    history({
      id: "history-hp-2",
      productId: "product-headphones",
      offerId: "offer-headphones-b",
      storeName: "Nihon Camera",
      listedPrice: 26980,
      shippingFee: 550,
      discountAmount: 0,
      couponDiscount: 0,
      pointValue: 600,
      effectivePrice: 26930,
      stockStatus: "in_stock",
      recordedAt: "2026-05-20T04:00:00.000Z",
      recordSource: "manual"
    }),
    history({
      id: "history-hp-3",
      productId: "product-headphones",
      offerId: "offer-headphones-a",
      storeName: "Tokyo Audio",
      listedPrice: 25800,
      shippingFee: 0,
      discountAmount: 500,
      couponDiscount: 0,
      pointValue: 1100,
      effectivePrice: 24200,
      stockStatus: "in_stock",
      recordedAt: "2026-06-10T04:00:00.000Z",
      recordSource: "manual"
    }),
    history({
      id: "history-hp-4",
      productId: "product-headphones",
      offerId: "offer-headphones-c",
      storeName: "Outlet Garage",
      listedPrice: 19800,
      shippingFee: 1200,
      discountAmount: 0,
      couponDiscount: 0,
      pointValue: 0,
      effectivePrice: 21000,
      stockStatus: "out_of_stock",
      recordedAt: "2026-06-25T04:00:00.000Z",
      recordSource: "manual",
      isExcludedFromLowestPrice: true,
      exclusionReason: "在庫切れ"
    }),
    history({
      id: "history-hp-5",
      productId: "product-headphones",
      offerId: "offer-headphones-a",
      storeName: "Tokyo Audio",
      listedPrice: 24800,
      shippingFee: 0,
      discountAmount: 800,
      couponDiscount: 1000,
      pointValue: 1200,
      effectivePrice: 21800,
      stockStatus: "in_stock",
      recordedAt: "2026-07-04T04:00:00.000Z",
      recordSource: "manual"
    }),
    history({
      id: "history-monitor-1",
      productId: "product-monitor",
      offerId: "offer-monitor-a",
      storeName: "Desk Lab",
      listedPrice: 49800,
      shippingFee: 0,
      discountAmount: 0,
      couponDiscount: 0,
      pointValue: 1800,
      effectivePrice: 48000,
      stockStatus: "in_stock",
      recordedAt: "2026-05-01T04:00:00.000Z",
      recordSource: "manual"
    }),
    history({
      id: "history-monitor-2",
      productId: "product-monitor",
      offerId: "offer-monitor-b",
      storeName: "PC Market",
      listedPrice: 45800,
      shippingFee: 800,
      discountAmount: 0,
      couponDiscount: 0,
      pointValue: 900,
      effectivePrice: 45700,
      stockStatus: "in_stock",
      recordedAt: "2026-06-18T04:00:00.000Z",
      recordSource: "manual"
    }),
    history({
      id: "history-monitor-3",
      productId: "product-monitor",
      offerId: "offer-monitor-a",
      storeName: "Desk Lab",
      listedPrice: 43800,
      shippingFee: 0,
      discountAmount: 3000,
      couponDiscount: 0,
      pointValue: 2200,
      effectivePrice: 38600,
      stockStatus: "in_stock",
      recordedAt: "2026-07-05T02:00:00.000Z",
      recordSource: "manual"
    }),
    history({
      id: "history-coffee-1",
      productId: "product-coffee",
      offerId: "offer-coffee-a",
      storeName: "Roast House",
      listedPrice: 4600,
      shippingFee: 0,
      discountAmount: 0,
      couponDiscount: 0,
      pointValue: 100,
      effectivePrice: 4500,
      stockStatus: "in_stock",
      recordedAt: "2026-07-04T01:00:00.000Z",
      recordSource: "manual"
    })
  ];

  return {
    userId: USER_ID,
    products,
    histories,
    settings: {
      ...DEFAULT_PRICE_SETTINGS,
      userId: USER_ID
    },
    ledgerEntries: []
  };
}
