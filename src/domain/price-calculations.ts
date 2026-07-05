import type { Offer, PriceChange, PriceSnapshot, PriceValidationResult, Product } from "./price-types";

export const MAX_REASONABLE_PRICE = 10_000_000;

export function toNumberOrNull(value: FormDataEntryValue | number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

export function calculateEffectivePrice(snapshot: Omit<PriceSnapshot, "effectivePrice" | "storeName" | "stockStatus">): number | null {
  if (snapshot.listedPrice === null) return null;
  return snapshot.listedPrice + snapshot.shippingFee - snapshot.discountAmount - snapshot.couponDiscount - snapshot.pointValue;
}

export function validatePriceSnapshot(snapshot: PriceSnapshot): PriceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const costFields: Array<[keyof PriceSnapshot, string]> = [
    ["listedPrice", "表示価格"],
    ["shippingFee", "送料"],
    ["discountAmount", "値引額"],
    ["couponDiscount", "クーポン値引額"],
    ["pointValue", "ポイント換算額"]
  ];

  for (const [field, label] of costFields) {
    const value = snapshot[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${label}を入力してください`);
      continue;
    }
    if (value < 0) errors.push(`${label}は0円以上で入力してください`);
    if (value > MAX_REASONABLE_PRICE) warnings.push(`${label}が非常に大きいため確認してください`);
  }

  const effectivePrice = calculateEffectivePrice(snapshot);
  if (effectivePrice !== null && effectivePrice < 0) {
    errors.push("実質価格が0円未満になるため、値引きやポイントを確認してください");
  }

  if (snapshot.stockStatus === "out_of_stock") {
    warnings.push("在庫切れは底値判定から除外されます");
  }

  return {
    effectivePrice: effectivePrice === null ? null : Math.max(0, effectivePrice),
    errors,
    warnings
  };
}

export function offerToSnapshot(offer: Offer): PriceSnapshot {
  return {
    storeName: offer.storeName,
    listedPrice: offer.listedPrice,
    shippingFee: offer.shippingFee,
    discountAmount: offer.discountAmount,
    couponDiscount: offer.couponDiscount,
    pointValue: offer.pointValue,
    effectivePrice: offer.effectivePrice,
    stockStatus: offer.stockStatus
  };
}

export function isCompletePrice(snapshot: Pick<PriceSnapshot, "listedPrice" | "shippingFee" | "discountAmount" | "couponDiscount" | "pointValue" | "effectivePrice">): boolean {
  return (
    snapshot.listedPrice !== null &&
    snapshot.effectivePrice !== null &&
    [snapshot.listedPrice, snapshot.shippingFee, snapshot.discountAmount, snapshot.couponDiscount, snapshot.pointValue, snapshot.effectivePrice].every(
      (value) => Number.isFinite(value) && value >= 0
    )
  );
}

export function isValidCurrentOffer(offer: Offer): boolean {
  return isCompletePrice(offerToSnapshot(offer));
}

export function determineCurrentOffer(product: Product): Offer | null {
  if (product.calculationOfferId) {
    const fixedOffer = product.offers.find((offer) => offer.id === product.calculationOfferId);
    return fixedOffer && isValidCurrentOffer(fixedOffer) ? fixedOffer : null;
  }

  const validOffers = product.offers
    .filter((offer) => isValidCurrentOffer(offer) && offer.stockStatus !== "out_of_stock")
    .sort((a, b) => {
      const effectiveDiff = (a.effectivePrice ?? Number.MAX_SAFE_INTEGER) - (b.effectivePrice ?? Number.MAX_SAFE_INTEGER);
      if (effectiveDiff !== 0) return effectiveDiff;
      const listedDiff = (a.listedPrice ?? Number.MAX_SAFE_INTEGER) - (b.listedPrice ?? Number.MAX_SAFE_INTEGER);
      if (listedDiff !== 0) return listedDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  return validOffers[0] ?? null;
}

export function calculateChange(current: number | null | undefined, previous: number | null | undefined): PriceChange {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) {
    return { amount: null, rate: null, direction: "unknown" };
  }

  const amount = current - previous;
  const rate = (amount / previous) * 100;
  return {
    amount,
    rate,
    direction: amount < 0 ? "down" : amount > 0 ? "up" : "same"
  };
}

export function yen(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "未設定";
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "未設定";
  return `${Math.abs(value).toFixed(1)}%`;
}

export function signedYen(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "未設定";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "±";
  return `${sign}${yen(Math.abs(value))}`;
}

export function absolutePercentageDifference(current: number, baseline: number): number {
  if (baseline === 0) return Number.POSITIVE_INFINITY;
  return Math.abs(((current - baseline) / baseline) * 100);
}
