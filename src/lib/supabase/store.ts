import type { SupabaseClient } from "@supabase/supabase-js";
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
  UserPriceSettings,
  WishlistPriority,
  WishlistStatus
} from "@/domain/price-types";
import { DEFAULT_PRICE_SETTINGS } from "@/domain/price-types";
import { calculateEffectivePrice, toNumberOrNull, validatePriceSnapshot } from "@/domain/price-calculations";
import { createPriceHistory, latestHistoryForOffer, shouldCreatePriceHistory } from "@/domain/price-history";
import { normalizeCandidateRanks } from "@/domain/ranking";
import { createSupabaseServerClient, getAuthenticatedUserId } from "./server";

interface ProductRow {
  id: string;
  user_id: string;
  name: string;
  category: string;
  detail_category: string | null;
  wishlist_status: WishlistStatus | null;
  priority: WishlistPriority | null;
  must_have_level: MustHaveLevel | null;
  candidate_rank: number | null;
  product_url: string | null;
  image_url: string | null;
  purchase_url: string | null;
  purchase_note: string | null;
  planned_purchase_month: string | null;
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
  wishlist_budget: number | null;
  monthly_household_budget: number | null;
  category_color_overrides: Record<string, string> | null;
  budget_period: BudgetPeriod | null;
  default_budget_view_mode: BudgetViewMode | null;
}

interface LedgerEntryRow {
  id: string;
  user_id: string;
  product_id: string | null;
  title: string;
  amount: number;
  entry_type: LedgerEntry["entryType"];
  category: string;
  occurred_on: string;
  note: string | null;
  created_at: string;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
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

function normalizeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function parseCategoryColorOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([category, color]) => [category.trim(), normalizeColor(color)] as const)
      .filter((entry): entry is [string, string] => entry[0].length > 0 && entry[1] !== null)
  );
}

function productFromRow(row: ProductRow, offers: Offer[]): Product {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    category: row.category,
    detailCategory: row.detail_category ?? row.category,
    wishlistStatus: parseWishlistStatus(row.wishlist_status),
    priority: parseWishlistPriority(row.priority),
    mustHaveLevel: parseMustHaveLevel(row.must_have_level),
    candidateRank: parseRank(row.candidate_rank),
    productUrl: row.product_url ?? null,
    imageUrl: row.image_url ?? null,
    purchaseUrl: row.purchase_url ?? null,
    purchaseNote: row.purchase_note ?? null,
    plannedPurchaseMonth: row.planned_purchase_month ?? null,
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
    stalePriceCheckDays: row.stale_price_check_days,
    wishlistBudget: row.wishlist_budget ?? DEFAULT_PRICE_SETTINGS.wishlistBudget,
    monthlyHouseholdBudget: row.monthly_household_budget ?? DEFAULT_PRICE_SETTINGS.monthlyHouseholdBudget,
    categoryColorOverrides: parseCategoryColorOverrides(row.category_color_overrides),
    budgetPeriod: parseBudgetPeriod(row.budget_period),
    defaultBudgetViewMode: parseBudgetViewMode(row.default_budget_view_mode)
  };
}

function ledgerEntryFromRow(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    title: row.title,
    amount: row.amount,
    entryType: parseLedgerEntryType(row.entry_type),
    category: row.category,
    occurredOn: row.occurred_on,
    note: row.note,
    createdAt: row.created_at
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

function ledgerEntryToRow(entry: LedgerEntry): LedgerEntryRow {
  return {
    id: entry.id,
    user_id: entry.userId,
    product_id: entry.productId ?? null,
    title: entry.title,
    amount: entry.amount,
    entry_type: entry.entryType,
    category: entry.category,
    occurred_on: entry.occurredOn,
    note: entry.note ?? null,
    created_at: entry.createdAt
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
    stale_price_check_days: defaults.stalePriceCheckDays,
    wishlist_budget: defaults.wishlistBudget,
    monthly_household_budget: defaults.monthlyHouseholdBudget,
    category_color_overrides: defaults.categoryColorOverrides,
    budget_period: defaults.budgetPeriod,
    default_budget_view_mode: defaults.defaultBudgetViewMode
  };
  await assertOk(supabase.from("user_price_settings").insert(row).select("*").single());
  return { ...defaults, userId };
}

async function readLedgerRows(supabase: SupabaseClient, userId: string): Promise<LedgerEntryRow[]> {
  const { data, error } = await supabase.from("ledger_entries").select("*").eq("user_id", userId).order("occurred_on", { ascending: false }).returns<LedgerEntryRow[]>();
  if (!error) return data ?? [];
  if (error.message.includes("ledger_entries") || error.message.includes("schema cache")) return [];
  throw new Error(error.message);
}

function productRowRankScope(row: ProductRow): string {
  return row.detail_category?.trim() || row.category.trim() || "未分類";
}

async function normalizeSupabaseCandidateRanks(supabase: SupabaseClient, userId: string): Promise<void> {
  const rows = await assertOk(supabase.from("products").select("*").eq("user_id", userId).returns<ProductRow[]>());
  const groups = new Map<string, ProductRow[]>();
  for (const row of rows ?? []) {
    const key = `${row.user_id}:${productRowRankScope(row)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const updates: Array<PromiseLike<{ data: unknown; error: { message: string } | null }>> = [];
  for (const group of groups.values()) {
    [...group]
      .sort((a, b) => {
        const rankDiff = parseRank(a.candidate_rank) - parseRank(b.candidate_rank);
        if (rankDiff !== 0) return rankDiff;
        const updatedDiff = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        if (updatedDiff !== 0) return updatedDiff;
        const createdDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (createdDiff !== 0) return createdDiff;
        return a.id.localeCompare(b.id);
      })
      .forEach((row, index) => {
        const nextRank = index + 1;
        if (parseRank(row.candidate_rank) !== nextRank) {
          updates.push(supabase.from("products").update({ candidate_rank: nextRank }).eq("id", row.id).eq("user_id", userId));
        }
      });
  }

  await Promise.all(updates.map((update) => assertOk(update)));
}

export async function readSupabaseState(): Promise<PriceAppState> {
  const supabase = await createSupabaseServerClient();
  const userId = await getAuthenticatedUserId();
  const [productRows, offerRows, historyRows, ledgerRows, settings] = await Promise.all([
    assertOk(supabase.from("products").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).returns<ProductRow[]>()),
    assertOk(supabase.from("offers").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).returns<OfferRow[]>()),
    assertOk(supabase.from("price_histories").select("*").eq("user_id", userId).order("recorded_at", { ascending: true }).returns<HistoryRow[]>()),
    readLedgerRows(supabase, userId),
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

  const normalizedProducts = normalizeCandidateRanks(products.map((row) => productFromRow(row, offersByProduct.get(row.id) ?? [])));

  return {
    userId,
    products: normalizedProducts,
    histories: histories.map(historyFromRow),
    settings,
    ledgerEntries: (ledgerRows ?? []).map(ledgerEntryFromRow)
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

  if (listedPrice !== null) {
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
  }

  await assertOk(
    supabase.from("products").insert({
      id: productId,
      user_id: userId,
      name: String(input.name ?? "新しい商品"),
      category: String(input.category ?? "未分類"),
      detail_category: String(input.detailCategory ?? input.category ?? "未分類"),
      wishlist_status: parseWishlistStatus(input.wishlistStatus),
      priority: parseWishlistPriority(input.priority),
      must_have_level: parseMustHaveLevel(input.mustHaveLevel),
      candidate_rank: parseRank(input.candidateRank),
      product_url: textOrNull(input.productUrl),
      image_url: textOrNull(input.imageUrl),
      purchase_url: textOrNull(input.purchaseUrl ?? input.productUrl),
      purchase_note: textOrNull(input.purchaseNote),
      planned_purchase_month: textOrNull(input.plannedPurchaseMonth),
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
  await normalizeSupabaseCandidateRanks(supabase, userId);
  return readSupabaseState();
}

export async function updateSupabaseProduct(productId: string, input: Record<string, unknown>): Promise<PriceAppState> {
  const supabase = await createSupabaseServerClient();
  const userId = await getAuthenticatedUserId();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("name" in input) {
    const name = textOrNull(input.name);
    if (!name) throw new Error("商品名を入力してください");
    patch.name = name;
  }
  if ("targetPrice" in input) patch.target_price = toNumberOrNull(String(input.targetPrice ?? ""));
  if ("customFloorPrice" in input) patch.custom_floor_price = toNumberOrNull(String(input.customFloorPrice ?? ""));
  if ("referencePrice" in input) patch.reference_price = toNumberOrNull(String(input.referencePrice ?? ""));
  if ("category" in input) patch.category = String(input.category ?? "未分類");
  if ("detailCategory" in input) patch.detail_category = String(input.detailCategory ?? "");
  if ("wishlistStatus" in input) patch.wishlist_status = parseWishlistStatus(input.wishlistStatus);
  if ("priority" in input) patch.priority = parseWishlistPriority(input.priority);
  if ("mustHaveLevel" in input) patch.must_have_level = parseMustHaveLevel(input.mustHaveLevel);
  if ("candidateRank" in input) patch.candidate_rank = parseRank(input.candidateRank);
  if ("productUrl" in input) patch.product_url = textOrNull(input.productUrl);
  if ("imageUrl" in input) patch.image_url = textOrNull(input.imageUrl);
  if ("purchaseUrl" in input) patch.purchase_url = textOrNull(input.purchaseUrl);
  if ("purchaseNote" in input) patch.purchase_note = textOrNull(input.purchaseNote);
  if ("plannedPurchaseMonth" in input) patch.planned_purchase_month = textOrNull(input.plannedPurchaseMonth);
  if ("calculationOfferId" in input) patch.calculation_offer_id = String(input.calculationOfferId ?? "");

  await assertOk(supabase.from("products").update(patch).eq("id", productId).eq("user_id", userId));
  if ("calculationOfferId" in input) {
    const nextOfferId = String(input.calculationOfferId ?? "");
    await assertOk(supabase.from("offers").update({ is_calculation_target: false }).eq("product_id", productId).eq("user_id", userId));
    await assertOk(supabase.from("offers").update({ is_calculation_target: true }).eq("id", nextOfferId).eq("product_id", productId).eq("user_id", userId));
  }
  await normalizeSupabaseCandidateRanks(supabase, userId);
  return readSupabaseState();
}

export async function deleteSupabaseProduct(productId: string): Promise<PriceAppState> {
  const supabase = await createSupabaseServerClient();
  const userId = await getAuthenticatedUserId();
  await assertOk(supabase.from("products").update({ calculation_offer_id: null }).eq("id", productId).eq("user_id", userId));
  await assertOk(supabase.from("products").delete().eq("id", productId).eq("user_id", userId));
  await normalizeSupabaseCandidateRanks(supabase, userId);
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

export async function createSupabaseLedgerEntry(input: Record<string, unknown>): Promise<PriceAppState> {
  const supabase = await createSupabaseServerClient();
  const userId = await getAuthenticatedUserId();
  const amount = toNumberOrNull(String(input.amount ?? ""));
  if (amount === null || amount < 0) throw new Error("金額は0円以上で入力してください");
  const now = new Date().toISOString();
  const entry: LedgerEntry = {
    id: newId("ledger"),
    userId,
    productId: textOrNull(input.productId),
    title: textOrNull(input.title) ?? "家計簿メモ",
    amount,
    entryType: parseLedgerEntryType(input.entryType),
    category: textOrNull(input.category) ?? "未分類",
    occurredOn: textOrNull(input.occurredOn) ?? now.slice(0, 10),
    note: textOrNull(input.note),
    createdAt: now
  };
  await assertOk(supabase.from("ledger_entries").insert(ledgerEntryToRow(entry)));
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
    stalePriceCheckDays: "stale_price_check_days",
    wishlistBudget: "wishlist_budget",
    monthlyHouseholdBudget: "monthly_household_budget"
  } as const;
  for (const [from, to] of Object.entries(mappings)) {
    if (from in input) {
      const value = toNumberOrNull(String(input[from] ?? ""));
      if (value !== null) patch[to] = value;
    }
  }
  if (input.preferredChartPeriod) patch.preferred_chart_period = String(input.preferredChartPeriod);
  if (input.preferredChartPriceType) patch.preferred_chart_price_type = String(input.preferredChartPriceType);
  if (input.budgetPeriod) patch.budget_period = parseBudgetPeriod(input.budgetPeriod);
  if (input.defaultBudgetViewMode) patch.default_budget_view_mode = parseBudgetViewMode(input.defaultBudgetViewMode);
  if ("categoryColorOverrides" in input) patch.category_color_overrides = parseCategoryColorOverrides(input.categoryColorOverrides);
  await assertOk(supabase.from("user_price_settings").update(patch).eq("user_id", userId));
  return readSupabaseState();
}
