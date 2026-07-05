import type {
  ChartBuildOptions,
  ChartPeriod,
  ChartPoint,
  DailyRepresentativeMode,
  PriceHistory,
  PriceMetrics,
  Product,
  UserPriceSettings
} from "./price-types";
import { calculateChange, determineCurrentOffer, isCompletePrice } from "./price-calculations";

export function isHistoryEligibleForLowest(history: PriceHistory): boolean {
  return (
    !history.isExcludedFromLowestPrice &&
    history.stockStatus !== "out_of_stock" &&
    isCompletePrice(history) &&
    history.shippingFee >= 0 &&
    history.discountAmount >= 0 &&
    history.couponDiscount >= 0 &&
    history.pointValue >= 0
  );
}

export function productHistories(histories: PriceHistory[], productId: string): PriceHistory[] {
  return histories
    .filter((history) => history.productId === productId)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
}

export function validLowestHistories(histories: PriceHistory[]): PriceHistory[] {
  return histories.filter(isHistoryEligibleForLowest);
}

export function getPeriodStart(now: Date, period: ChartPeriod | `${number}d`): Date | null {
  if (period === "all") return null;
  const result = new Date(now);
  if (period === "7d") result.setDate(result.getDate() - 7);
  else if (period === "30d") result.setDate(result.getDate() - 30);
  else if (period === "90d") result.setDate(result.getDate() - 90);
  else if (period === "6m") result.setMonth(result.getMonth() - 6);
  else if (period === "1y") result.setFullYear(result.getFullYear() - 1);
  else result.setDate(result.getDate() - Number.parseInt(period, 10));
  return result;
}

export function filterByPeriod(histories: PriceHistory[], now: Date, period: ChartPeriod | `${number}d`): PriceHistory[] {
  const start = getPeriodStart(now, period);
  if (!start) return histories;
  return histories.filter((history) => new Date(history.recordedAt).getTime() >= start.getTime());
}

export function getLowestHistory(histories: PriceHistory[], field: "effectivePrice" | "listedPrice" = "effectivePrice"): PriceHistory | null {
  const candidates = validLowestHistories(histories).filter((history) => history[field] !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((lowest, history) => {
    const value = history[field] ?? Number.POSITIVE_INFINITY;
    const lowestValue = lowest[field] ?? Number.POSITIVE_INFINITY;
    if (value < lowestValue) return history;
    if (value === lowestValue && new Date(history.recordedAt).getTime() < new Date(lowest.recordedAt).getTime()) return history;
    return lowest;
  });
}

export function getHighestHistory(histories: PriceHistory[], field: "effectivePrice" | "listedPrice" = "effectivePrice"): PriceHistory | null {
  const candidates = validLowestHistories(histories).filter((history) => history[field] !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((highest, history) => ((history[field] ?? 0) > (highest[field] ?? 0) ? history : highest));
}

export function averagePrice(histories: PriceHistory[], field: "effectivePrice" | "listedPrice" = "effectivePrice"): number | null {
  const values = validLowestHistories(histories)
    .map((history) => history[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculatePriceMetrics(product: Product, histories: PriceHistory[], settings: UserPriceSettings, now = new Date()): PriceMetrics {
  const currentOffer = determineCurrentOffer(product);
  const relevant = productHistories(histories, product.id);
  const valid = validLowestHistories(relevant);
  const latestValid = valid.at(-1) ?? null;
  const previousHistory = valid.length > 1 ? valid.at(-2) ?? null : latestValid;
  const currentEffectivePrice = currentOffer?.effectivePrice ?? null;
  const currentListedPrice = currentOffer?.listedPrice ?? null;
  const lowest30Histories = filterByPeriod(valid, now, "30d");
  const lowest90Histories = filterByPeriod(valid, now, "90d");
  const allTimeLowestEffective = getLowestHistory(valid, "effectivePrice");
  const targetDiff = product.targetPrice != null && currentEffectivePrice != null ? currentEffectivePrice - product.targetPrice : null;
  const customFloorDiff = product.customFloorPrice != null && currentEffectivePrice != null ? currentEffectivePrice - product.customFloorPrice : null;
  const previousPrice = previousHistory?.effectivePrice ?? null;

  void settings;

  return {
    currentOffer,
    currentListedPrice,
    currentEffectivePrice,
    previousHistory,
    previousChange: calculateChange(currentEffectivePrice, previousPrice),
    allTimeLowestEffective,
    allTimeLowestListed: getLowestHistory(valid, "listedPrice"),
    allTimeHighestEffective: getHighestHistory(valid, "effectivePrice"),
    lowest30Days: getLowestHistory(lowest30Histories, "effectivePrice"),
    lowest90Days: getLowestHistory(lowest90Histories, "effectivePrice"),
    average30Days: averagePrice(lowest30Histories, "effectivePrice"),
    average90Days: averagePrice(lowest90Histories, "effectivePrice"),
    targetDiff,
    customFloorDiff,
    lastCheckedAt: relevant.at(-1)?.recordedAt ?? null,
    validHistoryCount: valid.length,
    totalHistoryCount: relevant.length
  };
}

export function priceDifference(current: number | null, baseline: number | null): { amount: number | null; rate: number | null } {
  if (current === null || baseline === null || baseline === 0) return { amount: null, rate: null };
  return {
    amount: current - baseline,
    rate: ((current - baseline) / baseline) * 100
  };
}

export function isNearLowestPrice(current: number, lowest: number, settings: UserPriceSettings): boolean {
  const amount = current - lowest;
  const rate = lowest === 0 ? Number.POSITIVE_INFINITY : (amount / lowest) * 100;
  return amount <= settings.nearLowestAbsoluteThreshold || rate <= settings.nearLowestPercentageThreshold;
}

export function isLargeDrop(changeAmount: number | null, changeRate: number | null, settings: UserPriceSettings): boolean {
  if (changeAmount === null || changeRate === null) return false;
  return changeAmount <= -settings.largeDropAbsoluteThreshold || changeRate <= -settings.largeDropPercentageThreshold;
}

export function historyLabels(history: PriceHistory, allHistories: PriceHistory[], product: Product, now = new Date()): string[] {
  const valid = validLowestHistories(productHistories(allHistories, product.id));
  const lowest = getLowestHistory(valid, "effectivePrice");
  const lowest30 = getLowestHistory(filterByPeriod(valid, now, "30d"), "effectivePrice");
  const lowest90 = getLowestHistory(filterByPeriod(valid, now, "90d"), "effectivePrice");
  const labels: string[] = [];

  if (history.effectivePrice !== null && lowest?.effectivePrice === history.effectivePrice) {
    labels.push(lowest.id === history.id ? "過去最安" : "過去最安と同額");
  }
  if (history.effectivePrice !== null && lowest30?.effectivePrice === history.effectivePrice) labels.push("30日最安");
  if (history.effectivePrice !== null && lowest90?.effectivePrice === history.effectivePrice) labels.push("90日最安");
  if (product.targetPrice != null && history.effectivePrice != null && history.effectivePrice <= product.targetPrice) labels.push("目標価格以下");
  if (product.customFloorPrice != null && history.effectivePrice != null && history.effectivePrice <= product.customFloorPrice) labels.push("設定底値以下");
  if (history.isExcludedFromLowestPrice) labels.push("底値計算から除外");

  return Array.from(new Set(labels));
}

export function getStoreNames(product: Product, histories: PriceHistory[]): string[] {
  const names = new Set<string>();
  for (const offer of product.offers) names.add(offer.storeName);
  for (const history of productHistories(histories, product.id)) names.add(history.storeName);
  return Array.from(names).sort((a, b) => a.localeCompare(b, "ja"));
}

export function representativeHistory(histories: PriceHistory[], mode: DailyRepresentativeMode, field: "effectivePrice" | "listedPrice" = "effectivePrice"): PriceHistory {
  if (mode === "lowest") {
    return histories.reduce((lowest, history) => {
      const value = history[field] ?? Number.POSITIVE_INFINITY;
      const lowestValue = lowest[field] ?? Number.POSITIVE_INFINITY;
      if (value < lowestValue) return history;
      if (value === lowestValue && new Date(history.recordedAt).getTime() > new Date(lowest.recordedAt).getTime()) return history;
      return lowest;
    });
  }

  return histories.reduce((latest, history) =>
    new Date(history.recordedAt).getTime() > new Date(latest.recordedAt).getTime() ? history : latest
  );
}

function dateKey(dateIso: string): string {
  return new Date(dateIso).toISOString().slice(0, 10);
}

function chartPointFromHistory(history: PriceHistory, records: PriceHistory[] = [history]): ChartPoint {
  const timestamp = new Date(dateKey(history.recordedAt)).getTime();
  return {
    date: dateKey(history.recordedAt),
    timestamp,
    label: new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(history.recordedAt)),
    historyId: history.id,
    offerId: history.offerId,
    storeName: history.storeName,
    listedPrice: history.listedPrice,
    effectivePrice: history.effectivePrice,
    records
  };
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

export function buildChartData(product: Product, histories: PriceHistory[], options: ChartBuildOptions): ChartPoint[] {
  const currentOffer = determineCurrentOffer(product);
  let records = filterByPeriod(validLowestHistories(productHistories(histories, product.id)), options.now, options.period);

  if (options.storeViewMode === "calculation-target" && currentOffer) {
    records = records.filter((history) => history.offerId === currentOffer.id);
  }

  if (options.storeViewMode === "by-store") {
    const selected = options.selectedStores.length > 0 ? new Set(options.selectedStores) : new Set(getStoreNames(product, histories).slice(0, 4));
    const groups = groupBy(records.filter((history) => selected.has(history.storeName)), (history) => `${dateKey(history.recordedAt)}|${history.storeName}`);
    const dailyByStore = Array.from(groups.values()).map((items) => representativeHistory(items, options.dailyRepresentativeMode));
    const dailyGroups = groupBy(dailyByStore, (history) => dateKey(history.recordedAt));

    return Array.from(dailyGroups.entries())
      .map(([day, items]) => {
        const timestamp = new Date(day).getTime();
        const point: ChartPoint = {
          date: day,
          timestamp,
          label: new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(day)),
          records: items
        };
        for (const item of items) {
          point[`effective:${item.storeName}`] = item.effectivePrice;
          point[`listed:${item.storeName}`] = item.listedPrice;
        }
        return point;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  const dayOfferGroups = groupBy(records, (history) => `${dateKey(history.recordedAt)}|${history.offerId}`);
  const representativePerOffer = Array.from(dayOfferGroups.values()).map((items) => representativeHistory(items, options.dailyRepresentativeMode));
  const dayGroups = groupBy(representativePerOffer, (history) => dateKey(history.recordedAt));

  return Array.from(dayGroups.values())
    .map((items) => {
      const representative =
        options.storeViewMode === "overall-lowest" ? representativeHistory(items, "lowest", "effectivePrice") : representativeHistory(items, options.dailyRepresentativeMode);
      return chartPointFromHistory(representative, items);
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function sparklinePoints(product: Product, histories: PriceHistory[], limit = 12): number[] {
  return validLowestHistories(productHistories(histories, product.id))
    .slice(-limit)
    .map((history) => history.effectivePrice)
    .filter((value): value is number => value !== null);
}
