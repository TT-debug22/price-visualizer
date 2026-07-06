export type StockStatus = "in_stock" | "out_of_stock" | "unknown" | "preorder";

export type RecordSource =
  | "auto"
  | "manual"
  | "url_fetch"
  | "scheduled"
  | "external_api"
  | "extension"
  | "bookmarklet";

export type PriceType = "effective" | "listed" | "both";

export type ChartPeriod = "7d" | "30d" | "90d" | "6m" | "1y" | "all";

export type StoreViewMode = "overall-lowest" | "calculation-target" | "by-store";

export type DailyRepresentativeMode = "last" | "lowest";

export type WishlistStatus = "candidate" | "planned" | "purchased" | "on_hold" | "rejected";

export type WishlistPriority = "high" | "medium" | "low";

export type MustHaveLevel = "must" | "nice" | "optional";

export type BudgetViewMode = "planned" | "primary";

export type BudgetPeriod = "one_time" | "monthly" | "yearly";

export type LedgerEntryType = "expense" | "income";

export interface UserPriceSettings {
  userId: string;
  nearLowestAbsoluteThreshold: number;
  nearLowestPercentageThreshold: number;
  largeDropAbsoluteThreshold: number;
  largeDropPercentageThreshold: number;
  preferredChartPriceType: PriceType;
  preferredChartPeriod: ChartPeriod;
  stalePriceCheckDays: number;
  wishlistBudget: number;
  budgetPeriod: BudgetPeriod;
  defaultBudgetViewMode: BudgetViewMode;
}

export interface Offer {
  id: string;
  productId: string;
  storeName: string;
  listedPrice: number | null;
  shippingFee: number;
  discountAmount: number;
  couponDiscount: number;
  pointValue: number;
  effectivePrice: number | null;
  stockStatus: StockStatus;
  isCalculationTarget: boolean;
  updatedAt: string;
  sourceType?: "manual" | "api" | "scraper" | "extension" | "bookmarklet";
  externalProductId?: string;
  lastFetchedAt?: string | null;
  nextCheckAt?: string | null;
  fetchStatus?: "idle" | "success" | "failed";
  lastFetchError?: string | null;
  autoFetchEnabled?: boolean;
  priceAdapterKey?: string | null;
}

export interface Product {
  id: string;
  userId: string;
  name: string;
  category: string;
  detailCategory?: string | null;
  wishlistStatus: WishlistStatus;
  priority: WishlistPriority;
  mustHaveLevel: MustHaveLevel;
  candidateRank: number;
  productUrl?: string | null;
  imageUrl?: string | null;
  purchaseUrl?: string | null;
  purchaseNote?: string | null;
  plannedPurchaseMonth?: string | null;
  referencePrice?: number | null;
  targetPrice?: number | null;
  customFloorPrice?: number | null;
  calculationOfferId?: string | null;
  offers: Offer[];
  createdAt: string;
  updatedAt: string;
}

export interface PriceHistory {
  id: string;
  userId: string;
  productId: string;
  offerId: string;
  storeName: string;
  listedPrice: number | null;
  shippingFee: number;
  discountAmount: number;
  couponDiscount: number;
  pointValue: number;
  effectivePrice: number | null;
  stockStatus: StockStatus;
  recordedAt: string;
  recordSource: RecordSource;
  isExcludedFromLowestPrice: boolean;
  exclusionReason?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface PriceSnapshot {
  storeName: string;
  listedPrice: number | null;
  shippingFee: number;
  discountAmount: number;
  couponDiscount: number;
  pointValue: number;
  effectivePrice: number | null;
  stockStatus: StockStatus;
}

export interface PriceAppState {
  userId: string;
  products: Product[];
  histories: PriceHistory[];
  settings: UserPriceSettings;
  ledgerEntries: LedgerEntry[];
}

export interface LedgerEntry {
  id: string;
  userId: string;
  productId?: string | null;
  title: string;
  amount: number;
  entryType: LedgerEntryType;
  category: string;
  occurredOn: string;
  note?: string | null;
  createdAt: string;
}

export interface PriceValidationResult {
  effectivePrice: number | null;
  errors: string[];
  warnings: string[];
}

export interface PriceChange {
  amount: number | null;
  rate: number | null;
  direction: "down" | "up" | "same" | "unknown";
}

export interface PriceMetrics {
  currentOffer: Offer | null;
  currentListedPrice: number | null;
  currentEffectivePrice: number | null;
  previousHistory: PriceHistory | null;
  previousChange: PriceChange;
  allTimeLowestEffective: PriceHistory | null;
  allTimeLowestListed: PriceHistory | null;
  allTimeHighestEffective: PriceHistory | null;
  lowest30Days: PriceHistory | null;
  lowest90Days: PriceHistory | null;
  average30Days: number | null;
  average90Days: number | null;
  targetDiff: number | null;
  customFloorDiff: number | null;
  lastCheckedAt: string | null;
  validHistoryCount: number;
  totalHistoryCount: number;
}

export interface PriceEvaluation {
  kind:
    | "past_lowest"
    | "near_lowest"
    | "cheap"
    | "normal"
    | "expensive"
    | "insufficient_history"
    | "price_unset";
  label: string;
  tone: "best" | "good" | "neutral" | "bad" | "muted";
  evidence: string[];
  confidence: "low" | "medium" | "high";
}

export interface ChartPoint {
  date: string;
  timestamp: number;
  label: string;
  records: PriceHistory[];
  historyId?: string;
  offerId?: string;
  storeName?: string;
  listedPrice?: number | null;
  effectivePrice?: number | null;
  [key: string]: string | number | PriceHistory[] | null | undefined;
}

export interface ChartBuildOptions {
  period: ChartPeriod;
  priceType: PriceType;
  storeViewMode: StoreViewMode;
  selectedStores: string[];
  dailyRepresentativeMode: DailyRepresentativeMode;
  now: Date;
}

export const DEFAULT_PRICE_SETTINGS: UserPriceSettings = {
  userId: "demo-user",
  nearLowestAbsoluteThreshold: 500,
  nearLowestPercentageThreshold: 5,
  largeDropAbsoluteThreshold: 1000,
  largeDropPercentageThreshold: 5,
  preferredChartPriceType: "effective",
  preferredChartPeriod: "90d",
  stalePriceCheckDays: 14,
  wishlistBudget: 150000,
  budgetPeriod: "one_time",
  defaultBudgetViewMode: "planned"
};

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  in_stock: "在庫あり",
  out_of_stock: "在庫切れ",
  unknown: "在庫不明",
  preorder: "予約"
};

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  effective: "実質価格",
  listed: "表示価格",
  both: "両方"
};

export const CHART_PERIOD_LABELS: Record<ChartPeriod, string> = {
  "7d": "7日",
  "30d": "30日",
  "90d": "90日",
  "6m": "6か月",
  "1y": "1年",
  all: "全期間"
};

export const STORE_VIEW_LABELS: Record<StoreViewMode, string> = {
  "overall-lowest": "商品全体の最安実質価格推移",
  "calculation-target": "計算対象店舗のみ",
  "by-store": "店舗ごとの価格推移"
};

export const WISHLIST_STATUS_LABELS: Record<WishlistStatus, string> = {
  candidate: "候補",
  planned: "購入予定",
  purchased: "購入済み",
  on_hold: "保留",
  rejected: "見送り"
};

export const WISHLIST_PRIORITY_LABELS: Record<WishlistPriority, string> = {
  high: "高",
  medium: "中",
  low: "低"
};

export const MUST_HAVE_LABELS: Record<MustHaveLevel, string> = {
  must: "必須",
  nice: "できれば欲しい",
  optional: "余裕があれば"
};

export const BUDGET_VIEW_LABELS: Record<BudgetViewMode, string> = {
  planned: "購入予定",
  primary: "第一候補"
};

export const BUDGET_PERIOD_LABELS: Record<BudgetPeriod, string> = {
  one_time: "今回の買い物",
  monthly: "月次",
  yearly: "年次"
};
