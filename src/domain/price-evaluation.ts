import type { PriceAppState, PriceEvaluation, Product, UserPriceSettings } from "./price-types";
import { percent, signedYen, yen } from "./price-calculations";
import { calculatePriceMetrics, isLargeDrop, isNearLowestPrice, priceDifference } from "./price-analytics";

export function evaluateCurrentPrice(product: Product, histories: PriceAppState["histories"], settings: UserPriceSettings, now = new Date()): PriceEvaluation {
  const metrics = calculatePriceMetrics(product, histories, settings, now);
  const current = metrics.currentEffectivePrice;

  if (current === null) {
    return {
      kind: "price_unset",
      label: "価格未設定",
      tone: "muted",
      confidence: "low",
      evidence: ["現在価格を算出できません。表示価格、送料、値引き、在庫状況を確認してください。"]
    };
  }

  if (metrics.validHistoryCount < 3) {
    return {
      kind: "insufficient_history",
      label: "履歴不足",
      tone: "muted",
      confidence: "low",
      evidence: [`価格履歴が${metrics.validHistoryCount}件しかないため評価精度が低い状態です。`]
    };
  }

  const lowest = metrics.allTimeLowestEffective?.effectivePrice ?? null;
  const avg90 = metrics.average90Days;
  const evidence: string[] = [];

  if (lowest !== null) {
    const diff = priceDifference(current, lowest);
    if (diff.amount === 0) evidence.push("過去最安と同額です。");
    else if (diff.amount !== null && diff.amount > 0) evidence.push(`過去最安より${yen(diff.amount)}高いです。`);
    else if (diff.amount !== null && diff.amount < 0) evidence.push(`過去最安を${yen(Math.abs(diff.amount))}更新しています。`);
  }

  if (avg90 !== null) {
    const diff = priceDifference(current, avg90);
    if (diff.rate !== null && diff.rate < 0) evidence.push(`90日平均より${percent(diff.rate)}安いです。`);
    else if (diff.rate !== null && diff.rate > 0) evidence.push(`90日平均より${percent(diff.rate)}高いです。`);
    else evidence.push("90日平均と同水準です。");
  }

  if (metrics.targetDiff !== null) {
    evidence.push(metrics.targetDiff <= 0 ? `目標価格を${yen(Math.abs(metrics.targetDiff))}下回っています。` : `目標価格まであと${yen(metrics.targetDiff)}です。`);
  }
  if (metrics.customFloorDiff !== null) {
    evidence.push(
      metrics.customFloorDiff <= 0 ? `設定底値を${yen(Math.abs(metrics.customFloorDiff))}下回っています。` : `設定底値より${yen(metrics.customFloorDiff)}高いです。`
    );
  }

  if (lowest !== null && current <= lowest) {
    return { kind: "past_lowest", label: "過去最安", tone: "best", confidence: "high", evidence };
  }

  if (lowest !== null && isNearLowestPrice(current, lowest, settings)) {
    return { kind: "near_lowest", label: "最安圏内", tone: "good", confidence: "high", evidence: [...evidence, "過去最安圏内です。"] };
  }

  if (avg90 !== null) {
    const diff = priceDifference(current, avg90);
    if (diff.rate !== null && diff.rate <= -5) {
      return { kind: "cheap", label: "安い", tone: "good", confidence: "medium", evidence };
    }
    if (diff.rate !== null && diff.rate >= 5) {
      return { kind: "expensive", label: "高い", tone: "bad", confidence: "medium", evidence };
    }
  }

  return { kind: "normal", label: "通常", tone: "neutral", confidence: "medium", evidence };
}

export function currentLowestRelationship(product: Product, histories: PriceAppState["histories"], settings: UserPriceSettings, now = new Date()): string {
  const metrics = calculatePriceMetrics(product, histories, settings, now);
  const current = metrics.currentEffectivePrice;
  const lowest = metrics.allTimeLowestEffective?.effectivePrice ?? null;
  if (current === null || lowest === null) return "底値比較なし";
  const diff = current - lowest;
  if (diff === 0) return "過去最安と同額";
  if (diff > 0 && isNearLowestPrice(current, lowest, settings)) return `過去最安+${yen(diff)}・過去最安圏内`;
  if (diff > 0) return `過去最安より${percent((diff / lowest) * 100)}高い`;
  return `過去最安を${yen(Math.abs(diff))}更新`;
}

export interface DashboardBucket {
  title: string;
  products: Product[];
}

export function dashboardBuckets(state: PriceAppState, now = new Date()): DashboardBucket[] {
  const products = state.products;
  return [
    {
      title: "現在価格が過去最安の商品",
      products: products.filter((product) => evaluateCurrentPrice(product, state.histories, state.settings, now).kind === "past_lowest")
    },
    {
      title: "過去最安圏内の商品",
      products: products.filter((product) => evaluateCurrentPrice(product, state.histories, state.settings, now).kind === "near_lowest")
    },
    {
      title: "目標価格以下の商品",
      products: products.filter((product) => {
        const metrics = calculatePriceMetrics(product, state.histories, state.settings, now);
        return metrics.targetDiff !== null && metrics.targetDiff <= 0;
      })
    },
    {
      title: "設定底値以下の商品",
      products: products.filter((product) => {
        const metrics = calculatePriceMetrics(product, state.histories, state.settings, now);
        return metrics.customFloorDiff !== null && metrics.customFloorDiff <= 0;
      })
    },
    {
      title: "直近で大きく値下がりした商品",
      products: products.filter((product) => {
        const metrics = calculatePriceMetrics(product, state.histories, state.settings, now);
        return isLargeDrop(metrics.previousChange.amount, metrics.previousChange.rate, state.settings);
      })
    },
    {
      title: "直近で値上がりした商品",
      products: products.filter((product) => calculatePriceMetrics(product, state.histories, state.settings, now).previousChange.direction === "up")
    },
    {
      title: "価格確認から一定期間経過した商品",
      products: products.filter((product) => {
        const metrics = calculatePriceMetrics(product, state.histories, state.settings, now);
        if (!metrics.lastCheckedAt) return true;
        const elapsedDays = (now.getTime() - new Date(metrics.lastCheckedAt).getTime()) / 86_400_000;
        return elapsedDays >= state.settings.stalePriceCheckDays;
      })
    },
    {
      title: "価格履歴が不足している商品",
      products: products.filter((product) => evaluateCurrentPrice(product, state.histories, state.settings, now).kind === "insufficient_history")
    }
  ];
}

export function changeSummary(amount: number | null, rate: number | null): string {
  if (amount === null || rate === null) return "変動なし";
  if (amount === 0) return "変動なし";
  const label = amount < 0 ? "値下がり" : "値上がり";
  return `${label} ${signedYen(amount)} (${amount < 0 ? "-" : "+"}${percent(rate)})`;
}
