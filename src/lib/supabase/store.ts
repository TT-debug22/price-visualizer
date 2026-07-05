import type { SupabaseClient } from "@supabase/supabase-js";
import type { Offer, PriceAppState, PriceHistory, PriceSnapshot, Product, RecordSource, StockStatus, UserPriceSettings } from "@/domain/price-types";
import { DEFAULT_PRICE_SETTINGS } from "@/domain/price-types";
import { calculateEffectivePrice, toNumberOrNull, validatePriceSnapshot } from "@/domain/price-calculations";
import { createPriceHistory, latestHistoryForOffer, shouldCreatePriceHistory } from "@/domain/price-history";
import { createSupabaseServerClient, getAuthenticatedUserId } from "./server";

interface ProductRow {
  id: string;
  user_id: string;
  name: string;
  category: string;
  reference_price: number | null;
  target_price: number | null;
  custom_floor_price: number | null;
  calculation_offer_id: string | null;
  created_at: string;
  updated_at: string;
}

interface OfferRow {
  id: string;
  user_id: string;
  product_id: string;
  store_name: string;
  listed_price: number | null;
  shipping_fee: number;
  discount_amount: number;
  coupon_discount: number;
  point_value: number;
  effective_price: number | null;
  stock_status: StockStatus;
  is_calculation_target: boolean;
  updated_at: string;
  source_type: Offer["sourceType"];
  external_product_id: string | null;
  last_fetched_at: string | null;
  next_check_at: string | null;
  fetch_status: Offer["fetchStatus"];
  last_fetch_error: string | null;
  auto_fetch_enabled: boolean;
  price_adapter_key: string | null;
}

interface HistoryRow {
  id: string;
  user_id: string;
  product_id: string;
  offer_id: string;
  store_name: string;
  listed_price: number | null;
  shipping_fee: number;
  discount_amount: number;
  coupon_discount: number;
  point_value: number;
  effective_price: number | null;
  stock_status: StockStatus;
  recorded_at: string;
  record_source: RecordSource;
  is_excluded_from_lowest_price: boolean;
  exclusion_reason: string | null;
  note: string | null;
  created_at: string;
}

interface SettingsRow {
  user_id: string;
  near_lowest_absolute_threshold: number;
  near_lowest_percentage_threshold: number;
  large_drop_absolute_threshold: number;
  large_drop_percentage_threshold: number;
  preferred_chart_price_type: UserPriceSettings["preferredChartPriceType"];
  preferred_chart_period: UserPriceSettings["preferredChartPeriod"];
  stale_price_check_days: number;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function parseStockStatus(value: unknown): StockStatus {
  if (value === "out_of_stock" || value === "unknown" || value === "preorder") return value;
  return "in_stock";
}

function productFromRow(row: ProductRow, offers: Offer[]): Product {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    category: row.category,
    referencePrice: row.reference_price,
    targetPrice: row.target_price,
    customFloorPrice: row.custom_floor_price,
    calculationOfferId: row.calculation_offer_id,
    offers,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function offerFromRow(row: OfferRow): Offer {
  return {
    id: row.id,
    productId: row.product_id,
    storeName: row.store_name,
    listedPrice: row.listed_price,
    shippingFee: row.shipping_fee,
    discountAmount: row.discount_amount,
    couponDiscount: row.coupon_discount,
    pointValue: row.point_value,
    effectivePrice: row.effective_price,
    stockStatus: row.stock_status,
    isCalculationTarget: row.is_calculation_target,
    updatedAt: row.updated_at,
    sourceType: row.source_type,
    externalProductId: row.external_product_id ?? undefined,
    lastFetchedAt: row.last_fetched_at,
    nextCheckAt: row.next_check_at,
    fetchStatus: row.fetch_status,
    lastFetchError: row.last_fetch_error,
    autoFetchEnabled: row.auto_fetch_enabled,
    priceAdapterKey: row.price_adapter_key
  };
}

function historyFromRow(row: HistoryRow): PriceHistory {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    offerId: row.offer_id,
    storeName: row.store_name,
    listedPrice: row.listed_price,
    shippingFee: row.shipping_fee,
    discountAmount: row.discount_amount,
    couponDiscount: row.coupon_discount,
    pointValue: row.point_value,
    effectivePrice: row.effective_price,
    stockStatus: row.stock_status,
    recordedAt: row.recorded_at,
    recordSource: row.record_source,
    isExcludedFromLowestPrice: row.is_excluded_from_lowest_price,
    exclusionReason: row.exclusion_reason,
    note: row.note,
    createdAt: row.created_at
  };
}

function settingsFromRow(row: SettingsRow | null, userId: string): UserPriceSettings {
  if (!row) return { ...DEFAULT_PRICE_SETTINGS, userId };
  return {
    userId,
    nearLowestAbsoluteThreshold: row.near_lowest_absolute_threshold,
    nearLowestPercentageThreshold: row.near_lowest_percentage_threshold,
    largeDropAbsoluteThreshold: row.large_drop_absolute_threshold,
    largeDropPercentageThreshold: row.large_drop_percentage_threshold,
    preferredChartPriceType: row.preferred_chart_price_type,
    preferredChartPeriod: row.preferred_chart_period,
    stalePriceCheckDays: row.stale_price_check_days
  };
}

function offerToRow(offer: Offer, userId: string): OfferRow {
  return {
    id: offer.id,
    user_id: userId,
    product_id: offer.productId,
    store_name: offer.storeName,
    listed_price: offer.listedPrice,
    shipping_fee: offer.shippingFee,
    discount_amount: offer.discountAmount,
    coupon_discount: offer.couponDiscount,
    point_value: offer.pointValue,
    effective_price: offer.effectivePrice,
    stock_status: offer.stockStatus,
    is_calculation_target: offer.isCalculationTarget,
    updated_at: offer.updatedAt,
    source_type: offer.sourceType ?? "manual",
    external_product_id: offer.externalProductId ?? null,
    last_fetched_at: offer.lastFetchedAt ?? null,
    next_check_at: offer.nextCheckAt ?? null,
    fetch_status: offer.fetchStatus ?? "idle",
    last_fetch_error: offer.lastFetchError ?? null,
    auto_fetch_enabled: offer.autoFetchEnabled ?? false,
    price_adapter_key: offer.priceAdapterKey ?? null
  };
}

function historyToRow(history: PriceHistory): HistoryRow {
  return {
    id: history.id,
    user_id: history.userId,
    product_id: history.productId,
    offer_id: history.offerId,
    store_name: history.storeName,
    listed_price: history.listedPrice,
    shipping_fee: history.shippingFee,
    discount_amount: history.discountAmount,
    coupon_discount: history.couponDiscount,
    point_value: history.pointValue,
    effective_price: history.effectivePrice,
    stock_status: history.stockStatus,
    recorded_at: history.recordedAt,
    record_source: history.recordSource,
    is_excluded_from_lowest_price: history.isExcludedFromLowestPrice,
    exclusion_reason: history.exclusionReason ?? null,
    note: history.note ?? null,
    created_at: history.createdAt
  };
}

async function assertOk<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function ensureSettings(supabase: SupabaseClient, userId: string): Promise<UserPriceSettings> {
  const { data, error } = await supabase.from("user_price_settings").select("*").eq("user_id", userId).maybeSingle<SettingsRow>();
  if (error) throw new Error(error.message);
  if (data) return settingsFromRow(data, userId);

  const defaults = DEFAULT_PRICE_SETTINGS;
  const row = {
    user_id: userId,
    near_lowest_absolute_threshold: defaults.nearLowestAbsoluteThreshold,
    near_lowest_percentage_threshold: defaults.nearLowestPercentageThreshold,
    large_drop_absolute_threshold: defaults.largeDropAbsoluteThreshold,
    large_drop_percentage_threshold: defaults.largeDropPercentageThreshold,
    preferred_chart_price_type: defaults.preferredChartPriceType,
    preferred_chart_period: defaults.preferredChartPeriod,
    stale_price_check_days: defaults.stalePriceCheckDays
  };
  await assertOk(supabase.from("user_price_settings").insert(row).select("*").single());
  return { ...defaults, userId };
}

export async function readSupabaseState(): Promise<PriceAppState> {
  const supabase = await createSupabaseServerClient();
  const userId = await getAuthenticatedUserId();
  const [productRows, offerRows, historyRows, settings] = await Promise.all([
    assertOk(supabase.from("products").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).returns<ProductRow[]>()),
    assertOk(supabase.from("offers").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).returns<OfferRow[]>()),
    assertOk(supabase.from("price_histories").select("*").eq("user_id", userId).order("recorded_at", { ascending: true }).returns<HistoryRow[]>()),
    ensureSettings(supabase, userId)
  ]);

  const products = productRows ?? [];
  const offers = offerRows ?? [];
  const histories = historyRows ?? [];
  const offersByProduct = new Map<string, Offer[]>();
  for (const row of offers) {
    const offer = offerFromRow(row);
    offersByProduct.set(offer.productId, [...(offersByProduct.get(offer.productId) ?? []), offer]);
  }

  return {
    userId,
    products: products.map((row) => productFromRow(row, offersByProduct.get(row.id) ?? [])),
    histories: histories.map(historyFromRow),
    settings
  };
}

export async function createSupabaseProduct(input: Record<string, unknown>): Promise<PriceAppState> {
  const supabase = await createSupabaseServerClient();
  const userId = await getAuthenticatedUserId();
  const productId = newId("product");
  const offerId = newId("offer");
  const listedPrice = toNumberOrNull(String(input.listedPrice ?? ""));
  const shippingFee = toNumberOrNull(String(input.shippingFee ?? "0")) ?? 0;
  const discountAmount = toNumberOrNull(String(input.discountAmount ?? "0")) ?? 0;
  const couponDiscount = toNumberOrNull(String(input.couponDiscount ?? "0")) ?? 0;
  const pointValue = toNumberOrNull(String(input.pointValue ?? "0")) ?? 0;
  const now = new Date().toISOString();
  const effectivePrice = calculateEffectivePrice({ listedPrice, shippingFee, discountAmount, couponDiscount, pointValue });
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

  const validation = validatePriceSnapshot({
    storeName: offer.storeName,
    listedPrice: offer.listedPrice,
    shippingFee: offer.shippingFee,
    discountAmount: offer.discountAmount,
    couponDiscount: offer.couponDiscount,
    pointValue: offer.pointValue,
    effectivePrice: offer.effectivePrice,
    stockStatus: offer.stockStatus
  });
  if (validation.errors.length > 0) throw new Error(validation.errors.join(" / "));

  await assertOk(
    supabase.from("products").insert({
      id: productId,
      user_id: userId,
      name: String(input.name ?? "新しい商品"),
      category: String(input.category ?? "未分類"),
      reference_price: toNumberOrNull(String(input.referencePrice ?? "")),
      target_price: toNumberOrNull(String(input.targetPrice ?? "")),
      custom_floor_price: toNumberOrNull(String(input.customFloorPrice ?? "")),
      calculation_offer_id: null,
      created_at: now,
      updated_at: now
    })
  );
  await assertOk(supabase.from("offers").insert(offerToRow(offer, userId)));
  await assertOk(supabase.from("products").update({ calculation_offer_id: offerId }).eq("id", productId).eq("user_id", userId));
  return readSupabaseState();
}

export async function updateSupabaseProduct(productId: string, input: Record<string, unknown>): Promise<PriceAppState> {
  const supabase = await createSupabaseServerClient();
  const userId = await getAuthenticatedUserId();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("targetPrice" in input) patch.target_price = toNumberOrNull(String(input.targetPrice ?? ""));
  if ("customFloorPrice" in input) patch.custom_floor_price = toNumberOrNull(String(input.customFloorPrice ?? ""));
  if ("referencePrice" in input) patch.reference_price = toNumberOrNull(String(input.referencePrice ?? ""));
  if ("calculationOfferId" in input) patch.calculation_offer_id = String(input.calculationOfferId ?? "");

  await assertOk(supabase.from("products").update(patch).eq("id", productId).eq("user_id", userId));
  if ("calculationOfferId" in input) {
    const nextOfferId = String(input.calculationOfferId ?? "");
    await assertOk(supabase.from("offers").update({ is_calculation_target: false }).eq("product_id", productId).eq("user_id", userId));
    await assertOk(supabase.from("offers").update({ is_calculation_target: true }).eq("id", nextOfferId).eq("product_id", productId).eq("user_id", userId));
  }
  return readSupabaseState();
}

export async function recordSupabaseProductPrice(
  productId: string,
  input: Record<string, unknown>
): Promise<{ state: PriceAppState; createdHistory: PriceHistory | null; message: string }> {
  const supabase = await createSupabaseServerClient();
  const userId = await getAuthenticatedUserId();
  const state = await readSupabaseState();
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
  if (validation.errors.length > 0) throw new Error(validation.errors.join(" / "));
  snapshot.effectivePrice = validation.effectivePrice;

  const now = new Date();
  const updatedOffer: Offer = {
    ...offer,
    storeName: snapshot.storeName,
    listedPrice: snapshot.listedPrice,
    shippingFee: snapshot.shippingFee,
    discountAmount: snapshot.discountAmount,
    couponDiscount: snapshot.couponDiscount,
    pointValue: snapshot.pointValue,
    effectivePrice: snapshot.effectivePrice,
    stockStatus: snapshot.stockStatus,
    updatedAt: now.toISOString()
  };

  const previousHistory = latestHistoryForOffer(state.histories, productId, offer.id);
  const recentHistories = state.histories.filter((history) => history.productId === productId && history.offerId === offer.id);
  const recordSource = String(input.recordSource ?? "manual") as RecordSource;
  const decision = shouldCreatePriceHistory(previousHistory, snapshot, {
    isManualRecord: recordSource === "manual" || Boolean(input.forceManual),
    recentHistories,
    recordedAt: now
  });

  await assertOk(supabase.from("offers").update(offerToRow(updatedOffer, userId)).eq("id", offer.id).eq("user_id", userId));
  await assertOk(supabase.from("products").update({ updated_at: now.toISOString() }).eq("id", productId).eq("user_id", userId));

  let createdHistory: PriceHistory | null = null;
  if (decision.shouldCreate) {
    createdHistory = createPriceHistory({
      id: newId("history"),
      userId,
      productId,
      offer: updatedOffer,
      recordSource,
      recordedAt: now,
      note: typeof input.note === "string" ? input.note : null
    });
    await assertOk(supabase.from("price_histories").insert(historyToRow(createdHistory)));
  }

  return { state: await readSupabaseState(), createdHistory, message: decision.reason };
}

export async function updateSupabaseHistoryExclusion(productId: string, historyId: string, input: Record<string, unknown>): Promise<PriceAppState> {
  const supabase = await createSupabaseServerClient();
  const userId = await getAuthenticatedUserId();
  const excluded = Boolean(input.isExcludedFromLowestPrice);
  await assertOk(
    supabase
      .from("price_histories")
      .update({
        is_excluded_from_lowest_price: excluded,
        exclusion_reason: excluded ? String(input.exclusionReason ?? "ユーザーが除外") : null
      })
      .eq("product_id", productId)
      .eq("id", historyId)
      .eq("user_id", userId)
  );
  return readSupabaseState();
}

export async function updateSupabaseSettings(input: Record<string, unknown>): Promise<PriceAppState> {
  const supabase = await createSupabaseServerClient();
  const userId = await getAuthenticatedUserId();
  await ensureSettings(supabase, userId);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const mappings = {
    nearLowestAbsoluteThreshold: "near_lowest_absolute_threshold",
    nearLowestPercentageThreshold: "near_lowest_percentage_threshold",
    largeDropAbsoluteThreshold: "large_drop_absolute_threshold",
    largeDropPercentageThreshold: "large_drop_percentage_threshold",
    stalePriceCheckDays: "stale_price_check_days"
  } as const;
  for (const [from, to] of Object.entries(mappings)) {
    if (from in input) {
      const value = toNumberOrNull(String(input[from] ?? ""));
      if (value !== null) patch[to] = value;
    }
  }
  if (input.preferredChartPeriod) patch.preferred_chart_period = String(input.preferredChartPeriod);
  if (input.preferredChartPriceType) patch.preferred_chart_price_type = String(input.preferredChartPriceType);
  await assertOk(supabase.from("user_price_settings").update(patch).eq("user_id", userId));
  return readSupabaseState();
}
