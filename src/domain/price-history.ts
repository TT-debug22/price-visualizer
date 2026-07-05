import type { Offer, PriceHistory, PriceSnapshot, RecordSource } from "./price-types";
import { offerToSnapshot } from "./price-calculations";

const TRACKED_FIELDS: Array<keyof PriceSnapshot> = [
  "listedPrice",
  "shippingFee",
  "discountAmount",
  "couponDiscount",
  "pointValue",
  "effectivePrice",
  "stockStatus"
];

export interface HistoryDecision {
  shouldCreate: boolean;
  reason: string;
}

export interface HistoryCreateOptions {
  id: string;
  userId: string;
  productId: string;
  offer: Offer;
  recordSource: RecordSource;
  recordedAt: Date;
  note?: string | null;
}

export function snapshotsEqual(a: PriceSnapshot, b: PriceSnapshot): boolean {
  return TRACKED_FIELDS.every((field) => a[field] === b[field]);
}

export function historyToSnapshot(history: PriceHistory): PriceSnapshot {
  return {
    storeName: history.storeName,
    listedPrice: history.listedPrice,
    shippingFee: history.shippingFee,
    discountAmount: history.discountAmount,
    couponDiscount: history.couponDiscount,
    pointValue: history.pointValue,
    effectivePrice: history.effectivePrice,
    stockStatus: history.stockStatus
  };
}

export function hasRecentDuplicateHistory(histories: PriceHistory[], snapshot: PriceSnapshot, recordedAt: Date, duplicateWindowMs = 5 * 60 * 1000): boolean {
  return histories.some((history) => {
    const historyTime = new Date(history.recordedAt).getTime();
    return Math.abs(recordedAt.getTime() - historyTime) <= duplicateWindowMs && snapshotsEqual(historyToSnapshot(history), snapshot);
  });
}

export function shouldCreatePriceHistory(
  previousHistory: PriceHistory | null,
  newSnapshot: PriceSnapshot,
  options: {
    isManualRecord: boolean;
    recentHistories?: PriceHistory[];
    recordedAt?: Date;
    duplicateWindowMs?: number;
  }
): HistoryDecision {
  if (options.isManualRecord) {
    return { shouldCreate: true, reason: "手動記録のため同一価格でも保存します" };
  }

  if (!previousHistory) {
    return { shouldCreate: true, reason: "初回記録です" };
  }

  const previousSnapshot = historyToSnapshot(previousHistory);
  if (snapshotsEqual(previousSnapshot, newSnapshot)) {
    return { shouldCreate: false, reason: "価格情報に変化がありません" };
  }

  if (
    options.recentHistories &&
    hasRecentDuplicateHistory(options.recentHistories, newSnapshot, options.recordedAt ?? new Date(), options.duplicateWindowMs)
  ) {
    return { shouldCreate: false, reason: "短時間に同一価格が記録済みです" };
  }

  return { shouldCreate: true, reason: "価格情報が変化しました" };
}

export function createPriceHistory(options: HistoryCreateOptions): PriceHistory {
  const snapshot = offerToSnapshot(options.offer);
  const timestamp = options.recordedAt.toISOString();
  return {
    id: options.id,
    userId: options.userId,
    productId: options.productId,
    offerId: options.offer.id,
    storeName: snapshot.storeName,
    listedPrice: snapshot.listedPrice,
    shippingFee: snapshot.shippingFee,
    discountAmount: snapshot.discountAmount,
    couponDiscount: snapshot.couponDiscount,
    pointValue: snapshot.pointValue,
    effectivePrice: snapshot.effectivePrice,
    stockStatus: snapshot.stockStatus,
    recordedAt: timestamp,
    recordSource: options.recordSource,
    isExcludedFromLowestPrice: false,
    exclusionReason: null,
    note: options.note ?? null,
    createdAt: timestamp
  };
}

export function latestHistoryForOffer(histories: PriceHistory[], productId: string, offerId: string): PriceHistory | null {
  return histories
    .filter((history) => history.productId === productId && history.offerId === offerId)
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())[0] ?? null;
}
