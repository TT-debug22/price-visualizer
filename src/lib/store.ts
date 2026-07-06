import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  BudgetPeriod,
  BudgetViewMode,
  LedgerEntry,
  LedgerEntryType,
  MustHaveLevel,
  Offer,
  PriceAppState,
  PriceHistory,
  PriceSnapshot,
  Product,
  RecordSource,
  StockStatus,
  WishlistPriority,
  WishlistStatus
} from "@/domain/price-types";
import { DEFAULT_PRICE_SETTINGS } from "@/domain/price-types";
import { createInitialState } from "@/domain/fixtures";
import { calculateEffectivePrice, toNumberOrNull, validatePriceSnapshot } from "@/domain/price-calculations";
import { createPriceHistory, latestHistoryForOffer, shouldCreatePriceHistory } from "@/domain/price-history";
import { isSupabaseConfigured } from "./supabase/env";
import {
  createSupabaseProduct,
  createSupabaseLedgerEntry,
  readSupabaseState,
  recordSupabaseProductPrice,
  updateSupabaseHistoryExclusion,
  updateSupabaseProduct,
  updateSupabaseSettings
} from "./supabase/store";

const dataFile = process.env.PRICE_STATE_FILE ?? path.join(process.cwd(), ".data", "price-state.json");

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
}

export async function readState(): Promise<PriceAppState> {
  if (isSupabaseConfigured()) return readSupabaseState();
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    return normalizeState(JSON.parse(raw) as PriceAppState);
  } catch (error) {
    const state = createInitialState();
    await writeState(state);
    return normalizeState(state);
  }
}

export async function writeState(state: PriceAppState): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(dataFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function resetState(): Promise<PriceAppState> {
  if (isSupabaseConfigured()) {
    throw new Error("SupabaseモードではテストリセットAPIは無効です");
  }
  const state = createInitialState();
  await writeState(state);
  return state;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseStockStatus(value: unknown): StockStatus {
  if (value === "out_of_stock" || value === "unknown" || value === "preorder") return value;
  return "in_stock";
}

function parseWishlistStatus(value: unknown): WishlistStatus {
  if (value === "planned" || value === "purchased" || value === "on_hold" || value === "rejected") return value;
  return "candidate";
}

function parseWishlistPriority(value: unknown): WishlistPriority {
  if (value === "high" || value === "low") return value;
  return "medium";
}

function parseMustHaveLevel(value: unknown): MustHaveLevel {
  if (value === "must" || value === "optional") return value;
  return "nice";
}

function parseBudgetViewMode(value: unknown): BudgetViewMode {
  return value === "primary" ? "primary" : "planned";
}

function parseBudgetPeriod(value: unknown): BudgetPeriod {
  if (value === "monthly" || value === "yearly") return value;
  return "one_time";
}

function parseLedgerEntryType(value: unknown): LedgerEntryType {
  return value === "income" ? "income" : "expense";
}

function parseRank(value: unknown): number {
  const rank = Math.trunc(toNumberOrNull(String(value ?? "")) ?? 1);
  return Number.isFinite(rank) && rank > 0 ? rank : 1;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeProduct(product: Product): Product {
  return {
    ...product,
    detailCategory: product.detailCategory ?? product.category ?? "未分類",
    wishlistStatus: parseWishlistStatus(product.wishlistStatus),
    priority: parseWishlistPriority(product.priority),
    mustHaveLevel: parseMustHaveLevel(product.mustHaveLevel),
    candidateRank: parseRank(product.candidateRank),
    productUrl: product.productUrl ?? null,
    imageUrl: product.imageUrl ?? null,
    purchaseUrl: product.purchaseUrl ?? null,
    purchaseNote: product.purchaseNote ?? null,
    plannedPurchaseMonth: product.plannedPurchaseMonth ?? null
  };
}

function normalizeLedgerEntry(entry: LedgerEntry, userId: string): LedgerEntry {
  return {
    ...entry,
    userId,
    productId: entry.productId ?? null,
    amount: Math.max(0, Number.isFinite(entry.amount) ? entry.amount : 0),
    entryType: parseLedgerEntryType(entry.entryType),
    category: entry.category || "未分類",
    occurredOn: entry.occurredOn || new Date().toISOString().slice(0, 10),
    note: entry.note ?? null
  };
}

function normalizeState(state: PriceAppState): PriceAppState {
  return {
    ...state,
    products: state.products.map(normalizeProduct),
    histories: state.histories ?? [],
    ledgerEntries: (state.ledgerEntries ?? []).map((entry) => normalizeLedgerEntry(entry, state.userId)),
    settings: {
      ...DEFAULT_PRICE_SETTINGS,
      ...state.settings,
      userId: state.userId,
      wishlistBudget: state.settings?.wishlistBudget ?? DEFAULT_PRICE_SETTINGS.wishlistBudget,
      monthlyHouseholdBudget: state.settings?.monthlyHouseholdBudget ?? DEFAULT_PRICE_SETTINGS.monthlyHouseholdBudget,
      budgetPeriod: parseBudgetPeriod(state.settings?.budgetPeriod),
      defaultBudgetViewMode: parseBudgetViewMode(state.settings?.defaultBudgetViewMode)
    }
  };
}

export async function createProduct(input: Record<string, unknown>): Promise<PriceAppState> {
  if (isSupabaseConfigured()) return createSupabaseProduct(input);
  const state = await readState();
  const productId = newId("product");
  const offerId = newId("offer");
  const listedPrice = toNumberOrNull(String(input.listedPrice ?? ""));
  const shippingFee = toNumberOrNull(String(input.shippingFee ?? "0")) ?? 0;
  const discountAmount = toNumberOrNull(String(input.discountAmount ?? "0")) ?? 0;
  const couponDiscount = toNumberOrNull(String(input.couponDiscount ?? "0")) ?? 0;
  const pointValue = toNumberOrNull(String(input.pointValue ?? "0")) ?? 0;
  const now = new Date().toISOString();
  const effectivePrice = calculateEffectivePrice({
    listedPrice,
    shippingFee,
    discountAmount,
    couponDiscount,
    pointValue
  });
  const offer: Offer = {
    id: offerId,
    productId,
    storeName: textOrNull(input.storeName) ?? "未設定店舗",
    listedPrice,
    shippingFee,
    discountAmount,
    couponDiscount,
    pointValue,
    effectivePrice: effectivePrice === null ? null : Math.max(0, effectivePrice),
    stockStatus: parseStockStatus(input.stockStatus),
    isCalculationTarget: true,
    updatedAt: now,
    sourceType: "manual",
    lastFetchedAt: null,
    nextCheckAt: null,
    fetchStatus: "idle",
    lastFetchError: null,
    autoFetchEnabled: false,
    priceAdapterKey: null
  };

  const snapshot = {
    storeName: offer.storeName,
    listedPrice: offer.listedPrice,
    shippingFee: offer.shippingFee,
    discountAmount: offer.discountAmount,
    couponDiscount: offer.couponDiscount,
    pointValue: offer.pointValue,
    effectivePrice: offer.effectivePrice,
    stockStatus: offer.stockStatus
  };
  if (listedPrice !== null) {
    const validation = validatePriceSnapshot(snapshot);
    if (validation.errors.length > 0) {
      throw new Error(validation.errors.join(" / "));
    }
  }

  const product: Product = {
    id: productId,
    userId: state.userId,
    name: String(input.name ?? "新しい商品"),
    category: String(input.category ?? "未分類"),
    detailCategory: String(input.detailCategory ?? input.category ?? "未分類"),
    wishlistStatus: parseWishlistStatus(input.wishlistStatus),
    priority: parseWishlistPriority(input.priority),
    mustHaveLevel: parseMustHaveLevel(input.mustHaveLevel),
    candidateRank: parseRank(input.candidateRank),
    productUrl: textOrNull(input.productUrl),
    imageUrl: textOrNull(input.imageUrl),
    purchaseUrl: textOrNull(input.purchaseUrl ?? input.productUrl),
    purchaseNote: textOrNull(input.purchaseNote),
    plannedPurchaseMonth: textOrNull(input.plannedPurchaseMonth),
    referencePrice: toNumberOrNull(String(input.referencePrice ?? "")),
    targetPrice: toNumberOrNull(String(input.targetPrice ?? "")),
    customFloorPrice: toNumberOrNull(String(input.customFloorPrice ?? "")),
    calculationOfferId: offerId,
    offers: [offer],
    createdAt: now,
    updatedAt: now
  };

  state.products = [product, ...state.products];
  await writeState(state);
  return state;
}

export async function updateProduct(productId: string, input: Record<string, unknown>): Promise<PriceAppState> {
  if (isSupabaseConfigured()) return updateSupabaseProduct(productId, input);
  const state = await readState();
  const product = state.products.find((item) => item.id === productId);
  if (!product) throw new Error("商品が見つかりません");

  if ("targetPrice" in input) product.targetPrice = toNumberOrNull(String(input.targetPrice ?? ""));
  if ("customFloorPrice" in input) product.customFloorPrice = toNumberOrNull(String(input.customFloorPrice ?? ""));
  if ("referencePrice" in input) product.referencePrice = toNumberOrNull(String(input.referencePrice ?? ""));
  if ("category" in input) product.category = String(input.category ?? "未分類");
  if ("detailCategory" in input) product.detailCategory = String(input.detailCategory ?? product.category);
  if ("wishlistStatus" in input) product.wishlistStatus = parseWishlistStatus(input.wishlistStatus);
  if ("priority" in input) product.priority = parseWishlistPriority(input.priority);
  if ("mustHaveLevel" in input) product.mustHaveLevel = parseMustHaveLevel(input.mustHaveLevel);
  if ("candidateRank" in input) product.candidateRank = parseRank(input.candidateRank);
  if ("productUrl" in input) product.productUrl = textOrNull(input.productUrl);
  if ("imageUrl" in input) product.imageUrl = textOrNull(input.imageUrl);
  if ("purchaseUrl" in input) product.purchaseUrl = textOrNull(input.purchaseUrl);
  if ("purchaseNote" in input) product.purchaseNote = textOrNull(input.purchaseNote);
  if ("plannedPurchaseMonth" in input) product.plannedPurchaseMonth = textOrNull(input.plannedPurchaseMonth);
  if ("calculationOfferId" in input) {
    const nextOfferId = String(input.calculationOfferId ?? "");
    if (product.offers.some((offer) => offer.id === nextOfferId)) {
      product.calculationOfferId = nextOfferId;
      product.offers = product.offers.map((offer) => ({ ...offer, isCalculationTarget: offer.id === nextOfferId }));
    }
  }
  product.updatedAt = new Date().toISOString();

  await writeState(state);
  return state;
}

export async function recordProductPrice(
  productId: string,
  input: Record<string, unknown>
): Promise<{ state: PriceAppState; createdHistory: PriceHistory | null; message: string }> {
  if (isSupabaseConfigured()) return recordSupabaseProductPrice(productId, input);
  const state = await readState();
  const product = state.products.find((item) => item.id === productId);
  if (!product) throw new Error("商品が見つかりません");
  const offerId = String(input.offerId ?? product.calculationOfferId ?? product.offers[0]?.id ?? "");
  const offer = product.offers.find((item) => item.id === offerId);
  if (!offer) throw new Error("出品情報が見つかりません");

  const snapshot: PriceSnapshot = {
    storeName: String(input.storeName ?? offer.storeName),
    listedPrice: toNumberOrNull(String(input.listedPrice ?? offer.listedPrice ?? "")),
    shippingFee: toNumberOrNull(String(input.shippingFee ?? offer.shippingFee ?? 0)) ?? 0,
    discountAmount: toNumberOrNull(String(input.discountAmount ?? offer.discountAmount ?? 0)) ?? 0,
    couponDiscount: toNumberOrNull(String(input.couponDiscount ?? offer.couponDiscount ?? 0)) ?? 0,
    pointValue: toNumberOrNull(String(input.pointValue ?? offer.pointValue ?? 0)) ?? 0,
    effectivePrice: null,
    stockStatus: parseStockStatus(input.stockStatus ?? offer.stockStatus)
  };
  const validation = validatePriceSnapshot(snapshot);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join(" / "));
  }
  snapshot.effectivePrice = validation.effectivePrice;

  const now = new Date();
  offer.storeName = snapshot.storeName;
  offer.listedPrice = snapshot.listedPrice;
  offer.shippingFee = snapshot.shippingFee;
  offer.discountAmount = snapshot.discountAmount;
  offer.couponDiscount = snapshot.couponDiscount;
  offer.pointValue = snapshot.pointValue;
  offer.effectivePrice = snapshot.effectivePrice;
  offer.stockStatus = snapshot.stockStatus;
  offer.updatedAt = now.toISOString();
  product.updatedAt = now.toISOString();

  const recordSource = String(input.recordSource ?? "manual") as RecordSource;
  const previousHistory = latestHistoryForOffer(state.histories, productId, offer.id);
  const recentHistories = state.histories.filter((history) => history.productId === productId && history.offerId === offer.id);
  const decision = shouldCreatePriceHistory(previousHistory, snapshot, {
    isManualRecord: recordSource === "manual" || Boolean(input.forceManual),
    recentHistories,
    recordedAt: now
  });

  let createdHistory: PriceHistory | null = null;
  if (decision.shouldCreate) {
    createdHistory = createPriceHistory({
      id: newId("history"),
      userId: state.userId,
      productId,
      offer,
      recordSource,
      recordedAt: now,
      note: typeof input.note === "string" ? input.note : null
    });
    state.histories.push(createdHistory);
  }

  await writeState(state);
  return { state, createdHistory, message: decision.reason };
}

export async function updateHistoryExclusion(productId: string, historyId: string, input: Record<string, unknown>): Promise<PriceAppState> {
  if (isSupabaseConfigured()) return updateSupabaseHistoryExclusion(productId, historyId, input);
  const state = await readState();
  const history = state.histories.find((item) => item.productId === productId && item.id === historyId);
  if (!history) throw new Error("価格履歴が見つかりません");
  history.isExcludedFromLowestPrice = Boolean(input.isExcludedFromLowestPrice);
  history.exclusionReason = history.isExcludedFromLowestPrice ? String(input.exclusionReason ?? "ユーザーが除外") : null;
  await writeState(state);
  return state;
}

export async function createLedgerEntry(input: Record<string, unknown>): Promise<PriceAppState> {
  if (isSupabaseConfigured()) return createSupabaseLedgerEntry(input);
  const state = await readState();
  const amount = toNumberOrNull(String(input.amount ?? ""));
  if (amount === null || amount < 0) throw new Error("金額は0円以上で入力してください");
  const now = new Date().toISOString();
  const entry: LedgerEntry = {
    id: newId("ledger"),
    userId: state.userId,
    productId: textOrNull(input.productId),
    title: textOrNull(input.title) ?? "家計簿メモ",
    amount,
    entryType: parseLedgerEntryType(input.entryType),
    category: textOrNull(input.category) ?? "未分類",
    occurredOn: textOrNull(input.occurredOn) ?? now.slice(0, 10),
    note: textOrNull(input.note),
    createdAt: now
  };
  state.ledgerEntries = [entry, ...(state.ledgerEntries ?? [])];
  await writeState(state);
  return state;
}

export async function updateSettings(input: Record<string, unknown>): Promise<PriceAppState> {
  if (isSupabaseConfigured()) return updateSupabaseSettings(input);
  const state = await readState();
  const numericKeys = [
    "nearLowestAbsoluteThreshold",
    "nearLowestPercentageThreshold",
    "largeDropAbsoluteThreshold",
    "largeDropPercentageThreshold",
    "stalePriceCheckDays",
    "wishlistBudget",
    "monthlyHouseholdBudget"
  ] as const;
  for (const key of numericKeys) {
    if (key in input) {
      const value = toNumberOrNull(String(input[key] ?? ""));
      if (value !== null) state.settings[key] = value;
    }
  }
  if (input.preferredChartPeriod) state.settings.preferredChartPeriod = String(input.preferredChartPeriod) as PriceAppState["settings"]["preferredChartPeriod"];
  if (input.preferredChartPriceType) state.settings.preferredChartPriceType = String(input.preferredChartPriceType) as PriceAppState["settings"]["preferredChartPriceType"];
  if (input.budgetPeriod) state.settings.budgetPeriod = parseBudgetPeriod(input.budgetPeriod);
  if (input.defaultBudgetViewMode) state.settings.defaultBudgetViewMode = parseBudgetViewMode(input.defaultBudgetViewMode);
  await writeState(state);
  return state;
}
