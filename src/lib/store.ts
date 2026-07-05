import { promises as fs } from "node:fs";
import path from "node:path";
import type { Offer, PriceAppState, PriceHistory, PriceSnapshot, Product, RecordSource, StockStatus } from "@/domain/price-types";
import { createInitialState } from "@/domain/fixtures";
import { calculateEffectivePrice, toNumberOrNull, validatePriceSnapshot } from "@/domain/price-calculations";
import { createPriceHistory, latestHistoryForOffer, shouldCreatePriceHistory } from "@/domain/price-history";
import { isSupabaseConfigured } from "./supabase/env";
import {
  createSupabaseProduct,
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
    return JSON.parse(raw) as PriceAppState;
  } catch (error) {
    const state = createInitialState();
    await writeState(state);
    return state;
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
    storeName: String(input.storeName ?? "未設定店舗"),
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
  const validation = validatePriceSnapshot(snapshot);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join(" / "));
  }

  const product: Product = {
    id: productId,
    userId: state.userId,
    name: String(input.name ?? "新しい商品"),
    category: String(input.category ?? "未分類"),
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

export async function updateSettings(input: Record<string, unknown>): Promise<PriceAppState> {
  if (isSupabaseConfigured()) return updateSupabaseSettings(input);
  const state = await readState();
  const numericKeys = [
    "nearLowestAbsoluteThreshold",
    "nearLowestPercentageThreshold",
    "largeDropAbsoluteThreshold",
    "largeDropPercentageThreshold",
    "stalePriceCheckDays"
  ] as const;
  for (const key of numericKeys) {
    if (key in input) {
      const value = toNumberOrNull(String(input[key] ?? ""));
      if (value !== null) state.settings[key] = value;
    }
  }
  if (input.preferredChartPeriod) state.settings.preferredChartPeriod = String(input.preferredChartPeriod) as PriceAppState["settings"]["preferredChartPeriod"];
  if (input.preferredChartPriceType) state.settings.preferredChartPriceType = String(input.preferredChartPriceType) as PriceAppState["settings"]["preferredChartPriceType"];
  await writeState(state);
  return state;
}
