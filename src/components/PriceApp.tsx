"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, LogOut, Plus, Save, SlidersHorizontal, TrendingDown, TrendingUp } from "lucide-react";
import type {
  ChartPeriod,
  DailyRepresentativeMode,
  Offer,
  PriceAppState,
  PriceHistory,
  PriceType,
  Product,
  StockStatus,
  StoreViewMode
} from "@/domain/price-types";
import { CHART_PERIOD_LABELS, PRICE_TYPE_LABELS, STOCK_STATUS_LABELS, STORE_VIEW_LABELS } from "@/domain/price-types";
import { calculateEffectivePrice, determineCurrentOffer, percent, signedYen, validatePriceSnapshot, yen } from "@/domain/price-calculations";
import {
  buildChartData,
  calculatePriceMetrics,
  getStoreNames,
  historyLabels,
  priceDifference,
  productHistories,
  sparklinePoints,
  validLowestHistories
} from "@/domain/price-analytics";
import { changeSummary, currentLowestRelationship, dashboardBuckets, evaluateCurrentPrice } from "@/domain/price-evaluation";

const PriceTrendChart = dynamic(() => import("./PriceTrendChart"), {
  ssr: false,
  loading: () => <div className="empty-chart">価格推移グラフを読み込んでいます。</div>
});

const NOW = new Date("2026-07-05T04:00:00.000Z");
const CLOUD_MODE = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

class ApiResponseError extends Error {
  status: number;
  authRequired: boolean;

  constructor(message: string, status: number, authRequired = false) {
    super(message);
    this.status = status;
    this.authRequired = authRequired;
  }
}

function toneClass(tone: string): string {
  return `tone-${tone}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiResponseError(body.error ?? "処理に失敗しました", response.status, Boolean(body.authRequired));
  return body as T;
}

async function getBrowserSupabase() {
  const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
  return createSupabaseBrowserClient();
}

function AuthPanel({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = await getBrowserSupabase();
    if (!supabase) {
      setError("Supabase環境変数が未設定です。");
      setBusy(false);
      return;
    }

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined
            }
          });

    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === "sign-up" && !result.data.session) {
      setMessage("確認メールを送信しました。メール内のリンクを開いたあと、ログインしてください。");
      return;
    }

    onAuthenticated();
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <p className="eyebrow">Cloud Sync</p>
        <h1>価格データにログイン</h1>
        <p className="muted">外出先の iPhone からも同じ価格履歴を確認できます。</p>
        <form onSubmit={submit} className="stacked-form">
          <label>
            メールアドレス
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </label>
          <label>
            パスワード
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete={mode === "sign-in" ? "current-password" : "new-password"} />
          </label>
          {error && <p className="form-error">{error}</p>}
          {message && <p className="success-text">{message}</p>}
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "処理中" : mode === "sign-in" ? "ログイン" : "アカウント作成"}
          </button>
        </form>
        <button className="text-button auth-switch" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
          {mode === "sign-in" ? "初めて使う場合はアカウント作成" : "アカウントがある場合はログイン"}
        </button>
      </section>
    </main>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 3) return <span className="muted">履歴不足</span>;
  const width = 120;
  const height = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 6) - 3;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="直近価格の簡易推移">
      <polyline points={points} fill="none" stroke="#176b87" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProductCard({
  product,
  state,
  selected,
  onSelect
}: {
  product: Product;
  state: PriceAppState;
  selected: boolean;
  onSelect: () => void;
}) {
  const metrics = calculatePriceMetrics(product, state.histories, state.settings, NOW);
  const evaluation = evaluateCurrentPrice(product, state.histories, state.settings, NOW);
  const points = sparklinePoints(product, state.histories);

  return (
    <button className={`product-card ${selected ? "is-selected" : ""}`} onClick={onSelect} data-testid={`product-card-${product.id}`}>
      <span className="card-title">{product.name}</span>
      <span className="card-meta">{product.category}</span>
      <span className="price-row">
        <strong>{yen(metrics.currentEffectivePrice)}</strong>
        <span className={`badge ${toneClass(evaluation.tone)}`}>{evaluation.label}</span>
      </span>
      <span className="mini-grid">
        <span>前回比 {changeSummary(metrics.previousChange.amount, metrics.previousChange.rate)}</span>
        <span>過去最安 {yen(metrics.allTimeLowestEffective?.effectivePrice)}</span>
        <span>{currentLowestRelationship(product, state.histories, state.settings, NOW)}</span>
        <span>最終確認 {metrics.lastCheckedAt ? new Intl.DateTimeFormat("ja-JP").format(new Date(metrics.lastCheckedAt)) : "未確認"}</span>
      </span>
      <Sparkline values={points} />
    </button>
  );
}

function Dashboard({ state, onSelectProduct }: { state: PriceAppState; onSelectProduct: (productId: string) => void }) {
  const buckets = dashboardBuckets(state, NOW);
  return (
    <section className="dashboard" aria-label="価格ダッシュボード">
      {buckets.map((bucket) => (
        <div className="dashboard-bucket" key={bucket.title} data-testid={`dashboard-${bucket.title}`}>
          <h2>{bucket.title}</h2>
          {bucket.products.length === 0 ? (
            <p className="muted">該当なし</p>
          ) : (
            <div className="dashboard-items">
              {bucket.products.slice(0, 4).map((product) => (
                <button key={product.id} onClick={() => onSelectProduct(product.id)}>
                  {product.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function AddProductForm({ onCreated }: { onCreated: (state: PriceAppState) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setError(null);
    try {
      const state = await parseResponse<PriceAppState>(
        await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(formData))
        })
      );
      onCreated(state);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "商品を追加できませんでした");
    }
  }

  return (
    <div className="add-product">
      <button className="icon-button wide" onClick={() => setOpen((value) => !value)} data-testid="add-product-toggle">
        <Plus size={18} />
        商品追加
      </button>
      {open && (
        <form action={submit} className="stacked-form" data-testid="add-product-form">
          <label>
            商品名
            <input name="name" required placeholder="例: E2Eカメラ" />
          </label>
          <label>
            カテゴリ
            <input name="category" defaultValue="未分類" />
          </label>
          <label>
            店舗名
            <input name="storeName" required placeholder="例: テストストア" />
          </label>
          <div className="form-grid">
            <label>
              表示価格
              <input name="listedPrice" type="number" min="0" required />
            </label>
            <label>
              送料
              <input name="shippingFee" type="number" min="0" defaultValue="0" />
            </label>
            <label>
              値引額
              <input name="discountAmount" type="number" min="0" defaultValue="0" />
            </label>
            <label>
              クーポン
              <input name="couponDiscount" type="number" min="0" defaultValue="0" />
            </label>
            <label>
              ポイント
              <input name="pointValue" type="number" min="0" defaultValue="0" />
            </label>
            <label>
              目標価格
              <input name="targetPrice" type="number" min="0" />
            </label>
            <label>
              設定底値
              <input name="customFloorPrice" type="number" min="0" />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" type="submit">
            作成
          </button>
        </form>
      )}
    </div>
  );
}

function PriceSummary({ product, state }: { product: Product; state: PriceAppState }) {
  const metrics = calculatePriceMetrics(product, state.histories, state.settings, NOW);
  const lowest = metrics.allTimeLowestEffective;
  const change = metrics.previousChange;
  const changeLabel = change.direction === "down" ? "値下がり" : change.direction === "up" ? "値上がり" : "変動なし";

  return (
    <section className="summary-grid" aria-label="価格サマリー">
      <div>
        <span>現在の表示価格</span>
        <strong>{yen(metrics.currentListedPrice)}</strong>
      </div>
      <div>
        <span>現在の実質価格</span>
        <strong>{yen(metrics.currentEffectivePrice)}</strong>
      </div>
      <div className={change.direction === "down" ? "down" : change.direction === "up" ? "up" : ""}>
        <span>前回確認時から</span>
        <strong>
          {changeLabel} {signedYen(change.amount)} / {percent(change.rate)}
        </strong>
      </div>
      <div>
        <span>過去最安実質価格</span>
        <strong>{yen(lowest?.effectivePrice)}</strong>
      </div>
      <div>
        <span>過去最安記録日</span>
        <strong>{lowest ? new Intl.DateTimeFormat("ja-JP").format(new Date(lowest.recordedAt)) : "なし"}</strong>
      </div>
      <div>
        <span>過去最安店舗</span>
        <strong>{lowest?.storeName ?? "なし"}</strong>
      </div>
      <div>
        <span>30日最安価格</span>
        <strong>{yen(metrics.lowest30Days?.effectivePrice)}</strong>
      </div>
      <div>
        <span>90日最安価格</span>
        <strong>{yen(metrics.lowest90Days?.effectivePrice)}</strong>
      </div>
      <div>
        <span>90日平均価格</span>
        <strong>{yen(metrics.average90Days)}</strong>
      </div>
      <div>
        <span>目標価格との差額</span>
        <strong>{signedYen(metrics.targetDiff)}</strong>
      </div>
      <div>
        <span>設定底値との差額</span>
        <strong>{signedYen(metrics.customFloorDiff)}</strong>
      </div>
      <div>
        <span>最終確認日時 / 履歴件数</span>
        <strong>
          {metrics.lastCheckedAt ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date(metrics.lastCheckedAt)) : "未確認"} /{" "}
          {metrics.totalHistoryCount}件
        </strong>
      </div>
    </section>
  );
}

function EvaluationPanel({ product, state }: { product: Product; state: PriceAppState }) {
  const evaluation = evaluateCurrentPrice(product, state.histories, state.settings, NOW);
  return (
    <section className="evaluation-panel">
      <div className={`evaluation-badge ${toneClass(evaluation.tone)}`} data-testid="price-evaluation-label">
        {evaluation.label}
      </div>
      <div>
        <strong>評価根拠</strong>
        <ul>
          {evaluation.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ProductPriceSettings({ product, onUpdated }: { product: Product; onUpdated: (state: PriceAppState) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  async function submit(formData: FormData) {
    const state = await parseResponse<PriceAppState>(
      await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData))
      })
    );
    onUpdated(state);
    setMessage("価格設定を保存しました");
  }

  return (
    <form action={submit} className="inline-settings" data-testid="target-form">
      <label>
        目標価格
        <input name="targetPrice" type="number" min="0" defaultValue={product.targetPrice ?? ""} data-testid="target-price-input" />
      </label>
      <label>
        ユーザー設定底値
        <input name="customFloorPrice" type="number" min="0" defaultValue={product.customFloorPrice ?? ""} data-testid="floor-price-input" />
      </label>
      <button type="submit" className="icon-button" data-testid="save-target-price">
        <Save size={16} />
        保存
      </button>
      {message && <span className="success-text">{message}</span>}
    </form>
  );
}

function ManualPriceForm({ product, state, onRecorded }: { product: Product; state: PriceAppState; onRecorded: (state: PriceAppState) => void }) {
  const initialOffer = determineCurrentOffer(product) ?? product.offers[0];
  const [offerId, setOfferId] = useState(initialOffer?.id ?? "");
  const offer = product.offers.find((item) => item.id === offerId) ?? initialOffer;
  const [fields, setFields] = useState({
    listedPrice: offer?.listedPrice?.toString() ?? "",
    shippingFee: offer?.shippingFee.toString() ?? "0",
    discountAmount: offer?.discountAmount.toString() ?? "0",
    couponDiscount: offer?.couponDiscount.toString() ?? "0",
    pointValue: offer?.pointValue.toString() ?? "0",
    stockStatus: offer?.stockStatus ?? "in_stock",
    note: ""
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const currentOffer = product.offers.find((item) => item.id === offerId) ?? product.offers[0];
    if (!currentOffer) return;
    setFields({
      listedPrice: currentOffer.listedPrice?.toString() ?? "",
      shippingFee: currentOffer.shippingFee.toString(),
      discountAmount: currentOffer.discountAmount.toString(),
      couponDiscount: currentOffer.couponDiscount.toString(),
      pointValue: currentOffer.pointValue.toString(),
      stockStatus: currentOffer.stockStatus,
      note: ""
    });
  }, [offerId, product.id, product.offers]);

  const snapshot = {
    storeName: offer?.storeName ?? "",
    listedPrice: fields.listedPrice === "" ? null : Number(fields.listedPrice),
    shippingFee: Number(fields.shippingFee || 0),
    discountAmount: Number(fields.discountAmount || 0),
    couponDiscount: Number(fields.couponDiscount || 0),
    pointValue: Number(fields.pointValue || 0),
    effectivePrice: calculateEffectivePrice({
      listedPrice: fields.listedPrice === "" ? null : Number(fields.listedPrice),
      shippingFee: Number(fields.shippingFee || 0),
      discountAmount: Number(fields.discountAmount || 0),
      couponDiscount: Number(fields.couponDiscount || 0),
      pointValue: Number(fields.pointValue || 0)
    }),
    stockStatus: fields.stockStatus as StockStatus
  };
  const validation = validatePriceSnapshot(snapshot);
  const histories = productHistories(state.histories, product.id);
  const valid = validLowestHistories(histories);
  const previous = histories.filter((history) => history.offerId === offer?.id).at(-1) ?? null;
  const previousPrice = previous?.effectivePrice ?? offer?.effectivePrice ?? null;
  const nextPrice = validation.effectivePrice;
  const diff = priceDifference(nextPrice, previousPrice);
  const lowest = valid.reduce<PriceHistory | null>((current, history) => {
    if (!current) return history;
    return (history.effectivePrice ?? Number.POSITIVE_INFINITY) < (current.effectivePrice ?? Number.POSITIVE_INFINITY) ? history : current;
  }, null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const result = await parseResponse<{ state: PriceAppState; message: string }>(
        await fetch(`/api/products/${product.id}/record-price`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId, ...fields, recordSource: "manual", forceManual: true })
        })
      );
      onRecorded(result.state);
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "価格を記録できませんでした");
    }
  }

  return (
    <section className="form-panel">
      <h2>現在価格を記録</h2>
      <form onSubmit={submit} className="stacked-form" data-testid="manual-price-form">
        <label>
          出品情報
          <select value={offerId} onChange={(event) => setOfferId(event.target.value)} data-testid="offer-select">
            {product.offers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.storeName}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            表示価格
            <input
              name="listedPrice"
              type="number"
              min="0"
              value={fields.listedPrice}
              onChange={(event) => setFields((value) => ({ ...value, listedPrice: event.target.value }))}
              data-testid="listed-price-input"
            />
          </label>
          <label>
            送料
            <input type="number" min="0" value={fields.shippingFee} onChange={(event) => setFields((value) => ({ ...value, shippingFee: event.target.value }))} />
          </label>
          <label>
            値引額
            <input type="number" min="0" value={fields.discountAmount} onChange={(event) => setFields((value) => ({ ...value, discountAmount: event.target.value }))} />
          </label>
          <label>
            クーポン値引額
            <input type="number" min="0" value={fields.couponDiscount} onChange={(event) => setFields((value) => ({ ...value, couponDiscount: event.target.value }))} />
          </label>
          <label>
            ポイント換算額
            <input type="number" min="0" value={fields.pointValue} onChange={(event) => setFields((value) => ({ ...value, pointValue: event.target.value }))} />
          </label>
          <label>
            在庫状況
            <select value={fields.stockStatus} onChange={(event) => setFields((value) => ({ ...value, stockStatus: event.target.value as StockStatus }))}>
              {Object.entries(STOCK_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          メモ
          <input value={fields.note} onChange={(event) => setFields((value) => ({ ...value, note: event.target.value }))} />
        </label>
        <div className="preview-grid" data-testid="price-preview">
          <span>変更前価格: {yen(previousPrice)}</span>
          <span>変更後価格: {yen(nextPrice)}</span>
          <span data-testid="price-diff-preview">
            差額: {signedYen(diff.amount)} / {percent(diff.rate)}
          </span>
          <span>{lowest?.effectivePrice != null && nextPrice != null && nextPrice <= lowest.effectivePrice ? "過去最安値を更新します" : "過去最安値は更新しません"}</span>
          <span>{product.targetPrice != null && nextPrice != null && nextPrice <= product.targetPrice ? "目標価格以下になります" : "目標価格以下ではありません"}</span>
          <span>{product.customFloorPrice != null && nextPrice != null && nextPrice <= product.customFloorPrice ? "設定底値以下になります" : "設定底値以下ではありません"}</span>
        </div>
        {validation.errors.map((item) => (
          <p className="form-error" key={item}>
            {item}
          </p>
        ))}
        {validation.warnings.map((item) => (
          <p className="form-warning" key={item}>
            {item}
          </p>
        ))}
        {error && <p className="form-error">{error}</p>}
        {message && <p className="success-text">{message}</p>}
        <button type="submit" className="primary-button" disabled={validation.errors.length > 0} data-testid="record-price-button">
          現在価格を記録
        </button>
      </form>
    </section>
  );
}

function HistoryTable({ product, state, onUpdated }: { product: Product; state: PriceAppState; onUpdated: (state: PriceAppState) => void }) {
  const histories = [...productHistories(state.histories, product.id)].reverse();

  async function toggleExclusion(history: PriceHistory) {
    const nextExcluded = !history.isExcludedFromLowestPrice;
    const updated = await parseResponse<PriceAppState>(
      await fetch(`/api/products/${product.id}/histories/${history.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isExcludedFromLowestPrice: nextExcluded,
          exclusionReason: nextExcluded ? "ユーザーが除外" : null
        })
      })
    );
    onUpdated(updated);
  }

  return (
    <section className="history-panel">
      <h2>価格履歴</h2>
      {histories.length === 0 ? (
        <p className="muted" data-testid="history-insufficient">
          履歴がありません。
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>記録日時</th>
                <th>店舗</th>
                <th>表示価格</th>
                <th>実質価格</th>
                <th>在庫</th>
                <th>ラベル</th>
                <th>底値判定</th>
              </tr>
            </thead>
            <tbody>
              {histories.map((history) => {
                const labels = historyLabels(history, state.histories, product, NOW);
                return (
                  <tr key={history.id} data-testid={`history-row-${history.id}`} className={labels.includes("過去最安") ? "lowest-row" : ""}>
                    <td>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date(history.recordedAt))}</td>
                    <td>{history.storeName}</td>
                    <td>{yen(history.listedPrice)}</td>
                    <td>{yen(history.effectivePrice)}</td>
                    <td>{STOCK_STATUS_LABELS[history.stockStatus]}</td>
                    <td>
                      <div className="label-list">
                        {labels.map((label) => (
                          <span key={label} className="small-label">
                            {label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="text-button" onClick={() => toggleExclusion(history)} data-testid={`exclude-history-${history.id}`}>
                        {history.isExcludedFromLowestPrice ? "除外を解除" : "底値計算から除外"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ChartControls({
  product,
  state,
  period,
  setPeriod,
  priceType,
  setPriceType,
  storeViewMode,
  setStoreViewMode,
  selectedStores,
  setSelectedStores,
  dailyRepresentativeMode,
  setDailyRepresentativeMode
}: {
  product: Product;
  state: PriceAppState;
  period: ChartPeriod;
  setPeriod: (period: ChartPeriod) => void;
  priceType: PriceType;
  setPriceType: (type: PriceType) => void;
  storeViewMode: StoreViewMode;
  setStoreViewMode: (mode: StoreViewMode) => void;
  selectedStores: string[];
  setSelectedStores: (stores: string[]) => void;
  dailyRepresentativeMode: DailyRepresentativeMode;
  setDailyRepresentativeMode: (mode: DailyRepresentativeMode) => void;
}) {
  const stores = getStoreNames(product, state.histories);
  return (
    <section className="chart-controls" aria-label="グラフ操作">
      <div className="segmented" data-testid="period-controls">
        {(Object.keys(CHART_PERIOD_LABELS) as ChartPeriod[]).map((key) => (
          <button key={key} className={period === key ? "active" : ""} onClick={() => setPeriod(key)} data-testid={`period-${key}`}>
            {CHART_PERIOD_LABELS[key]}
          </button>
        ))}
      </div>
      <div className="segmented" data-testid="price-type-controls">
        {(Object.keys(PRICE_TYPE_LABELS) as PriceType[]).map((key) => (
          <button key={key} className={priceType === key ? "active" : ""} onClick={() => setPriceType(key)} data-testid={`price-type-${key}`}>
            {PRICE_TYPE_LABELS[key]}
          </button>
        ))}
      </div>
      <label className="select-label">
        表示方式
        <select value={storeViewMode} onChange={(event) => setStoreViewMode(event.target.value as StoreViewMode)} data-testid="store-view-select">
          {(Object.keys(STORE_VIEW_LABELS) as StoreViewMode[]).map((key) => (
            <option key={key} value={key}>
              {STORE_VIEW_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      <label className="select-label">
        同日代表価格
        <select value={dailyRepresentativeMode} onChange={(event) => setDailyRepresentativeMode(event.target.value as DailyRepresentativeMode)}>
          <option value="last">その日の最終価格</option>
          <option value="lowest">その日の最安価格</option>
        </select>
      </label>
      {storeViewMode === "by-store" && (
        <div className="store-picker" data-testid="store-picker">
          {stores.map((store) => (
            <label key={store}>
              <input
                type="checkbox"
                checked={selectedStores.includes(store)}
                onChange={(event) => {
                  if (event.target.checked) setSelectedStores([...selectedStores, store]);
                  else setSelectedStores(selectedStores.filter((item) => item !== store));
                }}
              />
              {store}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

function ProductDetail({ product, state, onStateChange }: { product: Product; state: PriceAppState; onStateChange: (state: PriceAppState) => void }) {
  const [period, setPeriod] = useState<ChartPeriod>(state.settings.preferredChartPeriod);
  const [priceType, setPriceType] = useState<PriceType>(state.settings.preferredChartPriceType);
  const [storeViewMode, setStoreViewMode] = useState<StoreViewMode>("overall-lowest");
  const [dailyRepresentativeMode, setDailyRepresentativeMode] = useState<DailyRepresentativeMode>("last");
  const stores = getStoreNames(product, state.histories);
  const [selectedStores, setSelectedStores] = useState<string[]>(stores.slice(0, 4));
  const chartData = buildChartData(product, state.histories, {
    period,
    priceType,
    storeViewMode,
    selectedStores,
    dailyRepresentativeMode,
    now: NOW
  });

  useEffect(() => {
    setSelectedStores(getStoreNames(product, state.histories).slice(0, 4));
  }, [product.id, state.histories, product]);

  return (
    <article className="detail">
      <div className="detail-header">
        <div>
          <p className="eyebrow">{product.category}</p>
          <h1>{product.name}</h1>
        </div>
        <div className="header-price">
          <span>現在の実質価格</span>
          <strong>{yen(calculatePriceMetrics(product, state.histories, state.settings, NOW).currentEffectivePrice)}</strong>
          <span>{currentLowestRelationship(product, state.histories, state.settings, NOW)}</span>
        </div>
      </div>
      <PriceSummary product={product} state={state} />
      <EvaluationPanel product={product} state={state} />
      <ProductPriceSettings product={product} onUpdated={onStateChange} />
      <ChartControls
        product={product}
        state={state}
        period={period}
        setPeriod={setPeriod}
        priceType={priceType}
        setPriceType={setPriceType}
        storeViewMode={storeViewMode}
        setStoreViewMode={setStoreViewMode}
        selectedStores={selectedStores}
        setSelectedStores={setSelectedStores}
        dailyRepresentativeMode={dailyRepresentativeMode}
        setDailyRepresentativeMode={setDailyRepresentativeMode}
      />
      <div className="chart-count" data-testid="chart-point-count">
        グラフ表示中の履歴: {chartData.length}点
      </div>
      <PriceTrendChart
        product={product}
        histories={state.histories}
        settings={state.settings}
        period={period}
        priceType={priceType}
        storeViewMode={storeViewMode}
        selectedStores={selectedStores}
        dailyRepresentativeMode={dailyRepresentativeMode}
        now={NOW}
      />
      <ManualPriceForm product={product} state={state} onRecorded={onStateChange} />
      <HistoryTable product={product} state={state} onUpdated={onStateChange} />
    </article>
  );
}

function GlobalSettings({ state, onUpdated }: { state: PriceAppState; onUpdated: (state: PriceAppState) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  async function submit(formData: FormData) {
    const nextState = await parseResponse<PriceAppState>(
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData))
      })
    );
    onUpdated(nextState);
    setMessage("判定条件を保存しました");
  }

  return (
    <section className="settings-panel">
      <h2>
        <SlidersHorizontal size={18} /> 判定条件
      </h2>
      <form action={submit} className="form-grid">
        <label>
          過去最安圏内 金額
          <input name="nearLowestAbsoluteThreshold" type="number" min="0" defaultValue={state.settings.nearLowestAbsoluteThreshold} />
        </label>
        <label>
          過去最安圏内 割合
          <input name="nearLowestPercentageThreshold" type="number" min="0" step="0.1" defaultValue={state.settings.nearLowestPercentageThreshold} />
        </label>
        <label>
          大きく値下がり 金額
          <input name="largeDropAbsoluteThreshold" type="number" min="0" defaultValue={state.settings.largeDropAbsoluteThreshold} />
        </label>
        <label>
          大きく値下がり 割合
          <input name="largeDropPercentageThreshold" type="number" min="0" step="0.1" defaultValue={state.settings.largeDropPercentageThreshold} />
        </label>
        <label>
          確認期限 日数
          <input name="stalePriceCheckDays" type="number" min="1" defaultValue={state.settings.stalePriceCheckDays} />
        </label>
        <button type="submit" className="primary-button">
          保存
        </button>
      </form>
      {message && <p className="success-text">{message}</p>}
    </section>
  );
}

export function PriceApp() {
  const [state, setState] = useState<PriceAppState | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  async function loadState() {
    setLoadingError(null);
    try {
      const nextState = await fetch("/api/state").then((response) => parseResponse<PriceAppState>(response));
      setState(nextState);
      setSelectedProductId(nextState.products[0]?.id ?? null);
      setAuthRequired(false);
    } catch (error) {
      if (error instanceof ApiResponseError && error.authRequired) {
        setAuthRequired(true);
        setState(null);
        return;
      }
      setLoadingError(error instanceof Error ? error.message : "データを読み込めませんでした");
    }
  }

  useEffect(() => {
    void loadState();
  }, []);

  async function signOut() {
    const supabase = await getBrowserSupabase();
    if (supabase) await supabase.auth.signOut();
    setState(null);
    setSelectedProductId(null);
    setAuthRequired(true);
  }

  const selectedProduct = useMemo(() => state?.products.find((product) => product.id === selectedProductId) ?? state?.products[0] ?? null, [selectedProductId, state]);

  if (authRequired) {
    return <AuthPanel onAuthenticated={() => void loadState()} />;
  }

  if (loadingError) {
    return <main className="app-shell error-state">{loadingError}</main>;
  }

  if (!state) {
    return <main className="app-shell">価格データを読み込んでいます。</main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Price Intelligence</p>
          <h1>商品価格の可視化</h1>
        </div>
        <div className="topbar-status">
          <span>
            <CheckCircle2 size={16} /> {CLOUD_MODE ? "クラウド同期" : "ローカルデモ"}
          </span>
          <span>
            <CheckCircle2 size={16} /> 表示価格と実質価格を分離
          </span>
          <span>
            <Clock3 size={16} /> 履歴 {state.histories.length}件
          </span>
          {CLOUD_MODE && (
            <button className="text-icon-button" onClick={() => void signOut()}>
              <LogOut size={16} /> ログアウト
            </button>
          )}
        </div>
      </header>
      <Dashboard state={state} onSelectProduct={setSelectedProductId} />
      <div className="workspace">
        <aside className="product-panel">
          <AddProductForm
            onCreated={(nextState) => {
              setState(nextState);
              setSelectedProductId(nextState.products[0]?.id ?? null);
            }}
          />
          <div className="panel-heading">
            <h2>商品一覧</h2>
            <span>{state.products.length}件</span>
          </div>
          <div className="product-list" data-testid="product-list">
            {state.products.map((product) => (
              <ProductCard key={product.id} product={product} state={state} selected={product.id === selectedProduct?.id} onSelect={() => setSelectedProductId(product.id)} />
            ))}
          </div>
        </aside>
        <section className="detail-panel">
          {selectedProduct ? (
            <ProductDetail product={selectedProduct} state={state} onStateChange={setState} />
          ) : (
            <div className="empty-chart">
              <AlertTriangle size={20} />
              商品を追加してください。
            </div>
          )}
        </section>
      </div>
      <GlobalSettings state={state} onUpdated={setState} />
      <footer className="footnote">
        <TrendingDown size={16} />
        自動スクレイピングは実装していません。将来の取得元/API/拡張機能は、価格取得処理と履歴保存処理を分離して接続できる設計です。
        <TrendingUp size={16} />
      </footer>
    </main>
  );
}

export default PriceApp;
