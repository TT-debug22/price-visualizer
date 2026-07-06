"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Plus,
  ReceiptText,
  Save,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Wallet
} from "lucide-react";
import type {
  BudgetPeriod,
  BudgetViewMode,
  ChartPeriod,
  DailyRepresentativeMode,
  LedgerEntry,
  LedgerEntryType,
  MustHaveLevel,
  Offer,
  PriceAppState,
  PriceHistory,
  PriceType,
  Product,
  StockStatus,
  StoreViewMode,
  WishlistPriority,
  WishlistStatus
} from "@/domain/price-types";
import {
  BUDGET_PERIOD_LABELS,
  BUDGET_VIEW_LABELS,
  CHART_PERIOD_LABELS,
  LEDGER_ENTRY_TYPE_LABELS,
  MUST_HAVE_LABELS,
  PRICE_TYPE_LABELS,
  STOCK_STATUS_LABELS,
  STORE_VIEW_LABELS,
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_STATUS_LABELS
} from "@/domain/price-types";
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
import { budgetEvidence, calculateBudgetSummary, groupProductsByCategory, wishlistPrice } from "@/domain/wishlist";
import { buildLedgerMonthSummary, buildLedgerTrend, defaultLedgerDate, ledgerMonthKey, ledgerMonthLabel } from "@/domain/ledger";

const PriceTrendChart = dynamic(() => import("./PriceTrendChart"), {
  ssr: false,
  loading: () => <div className="empty-chart">価格推移グラフを読み込んでいます。</div>
});

const NOW = new Date("2026-07-05T04:00:00.000Z");
const CLOUD_MODE = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

type AppTab = "overview" | "wishlist" | "ledger" | "price" | "settings";

const APP_TABS: Array<{ key: AppTab; label: string; icon: ComponentType<{ size?: number }> }> = [
  { key: "overview", label: "トップ", icon: LayoutDashboard },
  { key: "wishlist", label: "リスト", icon: ListChecks },
  { key: "ledger", label: "家計簿", icon: Wallet },
  { key: "price", label: "詳細", icon: BarChart3 },
  { key: "settings", label: "設定", icon: Settings }
];

const CATEGORY_COLORS = ["#176b87", "#0f766e", "#9a3412", "#7c3aed", "#be123c", "#2563eb", "#ca8a04", "#475569"];
const LEDGER_CATEGORIES = ["食費", "日用品", "交通", "趣味", "通信", "住居", "医療", "その他"];

interface CategorySlice {
  category: string;
  total: number;
  count: number;
  color: string;
}

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

function categoryKey(product: Product): string {
  return product.detailCategory || product.category || "未分類";
}

function categoryColor(category: string): string {
  let hash = 0;
  for (const char of category) hash = (hash * 31 + char.charCodeAt(0)) % CATEGORY_COLORS.length;
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

function categoryInitial(category: string): string {
  return Array.from(category || "未").slice(0, 1).join("");
}

function categorySlices(products: Product[]): CategorySlice[] {
  const groups = new Map<string, { total: number; count: number }>();
  for (const product of products) {
    const key = categoryKey(product);
    const current = groups.get(key) ?? { total: 0, count: 0 };
    groups.set(key, { total: current.total + wishlistPrice(product), count: current.count + 1 });
  }
  return Array.from(groups.entries())
    .map(([category, value]) => ({ category, total: value.total, count: value.count, color: categoryColor(category) }))
    .sort((a, b) => b.total - a.total);
}

function conicGradient(slices: CategorySlice[], total: number): string {
  if (slices.length === 0 || total <= 0) return "var(--surface-2)";
  let cursor = 0;
  const segments = slices.map((slice) => {
    const start = cursor;
    const end = cursor + (slice.total / total) * 100;
    cursor = end;
    return `${slice.color} ${start}% ${end}%`;
  });
  return `conic-gradient(${segments.join(", ")})`;
}

function ledgerCategorySlices(entries: Array<{ category: string; amount: number; count: number }>): CategorySlice[] {
  return entries.map((entry) => ({
    category: entry.category,
    total: entry.amount,
    count: entry.count,
    color: categoryColor(entry.category)
  }));
}

function maxTrendAmount(points: Array<{ incomeTotal: number; expenseTotal: number }>): number {
  return Math.max(1, ...points.flatMap((point) => [point.incomeTotal, point.expenseTotal]));
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

function AppTabs({ activeTab, onChange }: { activeTab: AppTab; onChange: (tab: AppTab) => void }) {
  return (
    <nav className="app-tabs" aria-label="機能切り替え">
      {APP_TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <button key={tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => onChange(tab.key)} data-testid={`tab-${tab.key}`}>
            <Icon size={17} />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

function BudgetModeControl({ mode, onChange }: { mode: BudgetViewMode; onChange: (mode: BudgetViewMode) => void }) {
  return (
    <div className="segmented" data-testid="budget-view-controls">
      {(Object.keys(BUDGET_VIEW_LABELS) as BudgetViewMode[]).map((key) => (
        <button key={key} className={mode === key ? "active" : ""} onClick={() => onChange(key)} data-testid={`budget-mode-${key}`}>
          {BUDGET_VIEW_LABELS[key]}の合計
        </button>
      ))}
    </div>
  );
}

function ProductVisual({ product }: { product: Product }) {
  const category = categoryKey(product);
  if (product.imageUrl) {
    return <img className="product-visual" src={product.imageUrl} alt={`${product.name}の写真`} loading="lazy" />;
  }
  return (
    <span className="product-visual product-visual-fallback" style={{ background: categoryColor(category) }} aria-hidden="true">
      {categoryInitial(category)}
    </span>
  );
}

function BudgetOverview({
  state,
  mode,
  onModeChange,
  onOpenProduct,
  onOpenLedger
}: {
  state: PriceAppState;
  mode: BudgetViewMode;
  onModeChange: (mode: BudgetViewMode) => void;
  onOpenProduct: (productId: string) => void;
  onOpenLedger: () => void;
}) {
  const summary = calculateBudgetSummary(state, mode);
  const slices = categorySlices(summary.products);
  const ledgerSummary = buildLedgerMonthSummary(state.ledgerEntries, ledgerMonthKey(NOW), state.settings.monthlyHouseholdBudget);
  const usage = summary.budget > 0 ? Math.min(100, Math.round((summary.total / summary.budget) * 100)) : 0;
  const unsetCount = summary.products.filter((product) => wishlistPrice(product) === 0).length;
  const chartBackground = conicGradient(slices, summary.total);

  return (
    <section className="overview-page" aria-label="欲しいものトップ">
      <div className="budget-hero">
        <div className="budget-main">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Wishlist Budget</p>
              <h2>{BUDGET_VIEW_LABELS[mode]}の予算チェック</h2>
            </div>
            <BudgetModeControl mode={mode} onChange={onModeChange} />
          </div>
          <div className="budget-amounts">
            <div>
              <span>予算</span>
              <strong>{yen(summary.budget)}</strong>
            </div>
            <div>
              <span>合計</span>
              <strong>{yen(summary.total)}</strong>
            </div>
            <div className={summary.isOverBudget ? "up" : "down"}>
              <span>{summary.isOverBudget ? "超過" : "残り"}</span>
              <strong>{yen(Math.abs(summary.remaining))}</strong>
            </div>
          </div>
          <div className="budget-meter" aria-label={`予算使用率 ${usage}%`}>
            <span style={{ width: `${usage}%` }} />
          </div>
          <p className="budget-evidence">{budgetEvidence(summary)}</p>
          {unsetCount > 0 && <p className="form-warning">価格未設定の商品が{unsetCount}件あります。合計には0円として入っています。</p>}
        </div>
        <div className="budget-chart-panel" aria-label="ジャンル別の金額内訳">
          <div className="budget-donut" style={{ background: chartBackground }}>
            <span>
              合計
              <strong>{yen(summary.total)}</strong>
            </span>
          </div>
          <div className="category-legend">
            {slices.length === 0 ? (
              <p className="muted">内訳はまだありません。</p>
            ) : (
              slices.map((slice) => (
                <div key={slice.category}>
                  <span className="category-swatch" style={{ background: slice.color }} />
                  <span>{slice.category}</span>
                  <strong>{yen(slice.total)}</strong>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="overview-grid">
        <section className="overview-panel">
          <div className="section-heading compact">
            <h2>対象商品</h2>
            <span>{summary.itemCount}件</span>
          </div>
          {summary.products.length === 0 ? (
            <p className="muted">購入予定または第一候補の商品を登録すると、ここに合計対象が表示されます。</p>
          ) : (
            <div className="compact-list" data-testid="budget-product-list">
              {summary.products.slice(0, 6).map((product) => (
                <button key={product.id} onClick={() => onOpenProduct(product.id)}>
                  <ProductVisual product={product} />
                  <span>{product.name}</span>
                  <strong>{yen(wishlistPrice(product))}</strong>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="overview-panel">
          <div className="section-heading compact">
            <h2>ジャンル別</h2>
            <span>{slices.length}分類</span>
          </div>
          <div className="category-summary-list">
            {slices.slice(0, 6).map((slice) => (
              <div key={slice.category}>
                <span className="category-swatch" style={{ background: slice.color }} />
                <span>{slice.category}</span>
                <strong>{yen(slice.total)}</strong>
                <small>{slice.count}件</small>
              </div>
            ))}
          </div>
        </section>
        <section className="overview-panel">
          <div className="section-heading compact">
            <h2>今月の家計簿</h2>
            <Wallet size={18} />
          </div>
          <div className="mini-ledger-summary">
            <span>支出</span>
            <strong>{yen(ledgerSummary.expenseTotal)}</strong>
            <span>{ledgerSummary.isOverBudget ? "予算超過" : "予算残り"}</span>
            <strong className={ledgerSummary.isOverBudget ? "up" : "down"}>{yen(Math.abs(ledgerSummary.budgetRemaining))}</strong>
          </div>
          <button className="text-button" onClick={onOpenLedger}>
            家計簿を開く
          </button>
        </section>
      </div>
    </section>
  );
}

function WishlistCategoryList({ state, onOpenProduct }: { state: PriceAppState; onOpenProduct: (productId: string) => void }) {
  const categories = groupProductsByCategory(state.products);
  return (
    <section className="wishlist-page" aria-label="欲しいものリスト">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Wishlist</p>
          <h2>詳細ジャンルごとの候補</h2>
        </div>
      </div>
      <div className="category-list">
        {categories.map((category) => (
          <article className="category-block" key={category.category} data-testid={`wishlist-category-${category.category}`}>
            <div className="category-header">
              <div>
                <h2>
                  <span className="category-swatch" style={{ background: categoryColor(category.category) }} />
                  {category.category}
                </h2>
                <p className="muted">購入予定 {category.plannedCount}件 / 第一候補 {category.primaryCount}件</p>
              </div>
              <strong>{yen(category.plannedTotal)}</strong>
            </div>
            <div className="candidate-list">
              {category.products.map((product) => (
                <button key={product.id} className="candidate-row" onClick={() => onOpenProduct(product.id)}>
                  <ProductVisual product={product} />
                  <span className="candidate-main">
                    <strong>{product.name}</strong>
                    <small>
                      第{product.candidateRank}候補 / {WISHLIST_STATUS_LABELS[product.wishlistStatus]}
                    </small>
                  </span>
                  <span className="candidate-price">{yen(wishlistPrice(product))}</span>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CandidateComparison({ state, onOpenProduct }: { state: PriceAppState; onOpenProduct: (productId: string) => void }) {
  const categories = groupProductsByCategory(state.products);
  return (
    <section className="compare-page" aria-label="候補比較">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Candidates</p>
          <h2>第一候補から下位候補まで比較</h2>
        </div>
      </div>
      <div className="comparison-grid">
        {categories.map((category) => (
          <article className="comparison-panel" key={category.category}>
            <h2>{category.category}</h2>
            <div className="comparison-table" role="table" aria-label={`${category.category}の候補比較`}>
              {category.products.map((product) => (
                <button key={product.id} role="row" onClick={() => onOpenProduct(product.id)}>
                  <span>第{product.candidateRank}候補</span>
                  <strong>{product.name}</strong>
                  <span>{yen(wishlistPrice(product))}</span>
                  <span>{WISHLIST_STATUS_LABELS[product.wishlistStatus]}</span>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
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

  return (
    <button className={`product-card ${selected ? "is-selected" : ""}`} onClick={onSelect} data-testid={`product-card-${product.id}`}>
      <ProductVisual product={product} />
      <span className="card-title">{product.name}</span>
      <span className="card-meta">{categoryKey(product)}</span>
      <span className="price-row">
        <strong>{yen(metrics.currentEffectivePrice)}</strong>
        <span className="badge tone-neutral">{WISHLIST_STATUS_LABELS[product.wishlistStatus]}</span>
      </span>
      <span className="mini-grid">
        <span>第{product.candidateRank}候補</span>
        <span>最終確認 {metrics.lastCheckedAt ? new Intl.DateTimeFormat("ja-JP").format(new Date(metrics.lastCheckedAt)) : "未確認"}</span>
      </span>
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

function LedgerEntryList({ entries }: { entries: LedgerEntry[] }) {
  if (entries.length === 0) {
    return <p className="muted">この月の記録はまだありません。</p>;
  }

  return (
    <div className="ledger-list" data-testid="ledger-entry-list">
      {entries.map((entry) => (
        <div className="ledger-row" key={entry.id}>
          <span className="ledger-row-icon" style={{ background: categoryColor(entry.category) }}>
            {entry.entryType === "income" ? "+" : "-"}
          </span>
          <div>
            <strong>{entry.title}</strong>
            <small>
              {entry.occurredOn} / {entry.category}
            </small>
          </div>
          <strong className={entry.entryType === "income" ? "down" : "up"}>
            {entry.entryType === "income" ? "+" : "-"}
            {yen(entry.amount)}
          </strong>
        </div>
      ))}
    </div>
  );
}

function HouseholdBook({ state, onStateChange }: { state: PriceAppState; onStateChange: (state: PriceAppState) => void }) {
  const [month, setMonth] = useState(ledgerMonthKey(NOW));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = buildLedgerMonthSummary(state.ledgerEntries, month, state.settings.monthlyHouseholdBudget);
  const slices = ledgerCategorySlices(summary.categorySummaries);
  const chartBackground = conicGradient(slices, summary.expenseTotal);
  const budgetUsage = summary.budget > 0 ? Math.min(100, Math.round((summary.expenseTotal / summary.budget) * 100)) : 0;
  const trend = buildLedgerTrend(state.ledgerEntries, month, 6);
  const trendMax = maxTrendAmount(trend);

  async function submit(formData: FormData) {
    setMessage(null);
    setError(null);
    try {
      const nextState = await parseResponse<PriceAppState>(
        await fetch("/api/ledger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(formData))
        })
      );
      onStateChange(nextState);
      setMessage("家計簿に記録しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "家計簿を記録できませんでした");
    }
  }

  return (
    <section className="ledger-page" aria-label="家計簿">
      <div className="section-heading ledger-heading">
        <div>
          <p className="eyebrow">Household Book</p>
          <h2>{ledgerMonthLabel(month)}の家計簿</h2>
        </div>
        <label className="month-control">
          対象月
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} data-testid="ledger-month-input" />
        </label>
      </div>

      <section className="ledger-hero">
        <div className="ledger-summary-cards">
          <div>
            <span>収入</span>
            <strong className="down">{yen(summary.incomeTotal)}</strong>
          </div>
          <div>
            <span>支出</span>
            <strong className="up">{yen(summary.expenseTotal)}</strong>
          </div>
          <div>
            <span>収支</span>
            <strong className={summary.balance >= 0 ? "down" : "up"}>{signedYen(summary.balance)}</strong>
          </div>
          <div>
            <span>{summary.isOverBudget ? "予算超過" : "予算残り"}</span>
            <strong className={summary.isOverBudget ? "up" : "down"}>{yen(Math.abs(summary.budgetRemaining))}</strong>
          </div>
        </div>
        <div className="ledger-budget-meter">
          <div>
            <span>月予算 {yen(summary.budget)}</span>
            <strong>{budgetUsage}%</strong>
          </div>
          <div className="budget-meter" aria-label={`家計簿予算使用率 ${budgetUsage}%`}>
            <span style={{ width: `${budgetUsage}%` }} />
          </div>
        </div>
      </section>

      <div className="ledger-grid">
        <section className="ledger-chart-card">
          <div className="section-heading compact">
            <h2>支出内訳</h2>
            <ReceiptText size={18} />
          </div>
          <div className="budget-chart-panel ledger-chart-panel">
            <div className="budget-donut" style={{ background: chartBackground }}>
              <span>
                支出
                <strong>{yen(summary.expenseTotal)}</strong>
              </span>
            </div>
            <div className="category-legend">
              {slices.length === 0 ? (
                <p className="muted">支出を記録すると内訳が表示されます。</p>
              ) : (
                slices.map((slice) => (
                  <div key={slice.category}>
                    <span className="category-swatch" style={{ background: slice.color }} />
                    <span>{slice.category}</span>
                    <strong>{yen(slice.total)}</strong>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="ledger-form-card">
          <div className="section-heading compact">
            <h2>記録する</h2>
            <CalendarDays size={18} />
          </div>
          <form action={submit} className="ledger-form" data-testid="ledger-form">
            <label>
              内容
              <input name="title" required placeholder="例: スーパー、給与、交通費" />
            </label>
            <div className="ledger-form-row">
              <label>
                金額
                <input name="amount" type="number" min="0" required placeholder="例: 3200" />
              </label>
              <label>
                種別
                <select name="entryType" defaultValue="expense" data-testid="ledger-entry-type">
                  {(Object.keys(LEDGER_ENTRY_TYPE_LABELS) as LedgerEntryType[]).map((key) => (
                    <option key={key} value={key}>
                      {LEDGER_ENTRY_TYPE_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ledger-form-row">
              <label>
                カテゴリ
                <input name="category" list="ledger-categories" defaultValue="食費" />
                <datalist id="ledger-categories">
                  {LEDGER_CATEGORIES.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </label>
              <label>
                日付
                <input name="occurredOn" type="date" defaultValue={defaultLedgerDate(month, NOW)} />
              </label>
            </div>
            <label>
              メモ
              <input name="note" placeholder="必要ならメモ" />
            </label>
            {error && <p className="form-error">{error}</p>}
            {message && <p className="success-text">{message}</p>}
            <button type="submit" className="primary-button">
              家計簿に追加
            </button>
          </form>
        </section>

        <section className="ledger-list-card">
          <div className="section-heading compact">
            <h2>この月の記録</h2>
            <span>
              支出 {summary.expenseCount}件 / 収入 {summary.incomeCount}件
            </span>
          </div>
          <LedgerEntryList entries={summary.entries} />
        </section>

        <section className="ledger-trend-card">
          <div className="section-heading compact">
            <h2>6か月の流れ</h2>
            <span>支出と収入</span>
          </div>
          <div className="ledger-trend" aria-label="過去6か月の収支">
            {trend.map((point) => (
              <div key={point.month}>
                <span>{point.label}</span>
                <div className="trend-bars">
                  <span className="trend-income" style={{ height: `${Math.max(4, (point.incomeTotal / trendMax) * 100)}%` }} />
                  <span className="trend-expense" style={{ height: `${Math.max(4, (point.expenseTotal / trendMax) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
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
        欲しいものを追加
      </button>
      {open && (
        <form action={submit} className="stacked-form quick-add-form" data-testid="add-product-form">
          <label>
            商品名
            <input name="name" required placeholder="例: ミラーレスカメラ" />
          </label>
          <div className="quick-add-grid">
            <label>
              ジャンル
              <input name="detailCategory" placeholder="例: カメラ、デスク、服" />
            </label>
            <label>
              予定金額
              <input name="listedPrice" type="number" min="0" placeholder="例: 98000" />
            </label>
            <label>
              予算対象
              <select name="wishlistStatus" defaultValue="planned">
                <option value="planned">購入予定に入れる</option>
                <option value="candidate">候補として保存</option>
              </select>
            </label>
          </div>
          <label>
            写真URL
            <input name="imageUrl" type="url" placeholder="https://..." />
          </label>
          <details className="advanced-create">
            <summary>詳細条件を入力する</summary>
            <div className="form-grid">
              <label>
                大カテゴリ
                <input name="category" defaultValue="未分類" />
              </label>
              <label>
                候補順位
                <input name="candidateRank" type="number" min="1" defaultValue="1" />
              </label>
              <label>
                商品URL
                <input name="productUrl" type="url" placeholder="https://..." />
              </label>
              <label>
                購入予定月
                <input name="plannedPurchaseMonth" type="month" />
              </label>
              <label>
                購入先URL
                <input name="purchaseUrl" type="url" placeholder="https://..." />
              </label>
              <label>
                店舗名
                <input name="storeName" placeholder="例: 公式ストア" />
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
            <label>
              メモ
              <input name="purchaseNote" placeholder="比較理由、買う条件など" />
            </label>
          </details>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" type="submit">
            追加
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
    <section className="form-panel product-edit-panel">
      <div className="section-heading compact">
        <h2>商品情報と購入条件</h2>
        {message && <span className="success-text">{message}</span>}
      </div>
      <form action={submit} className="inline-settings product-edit-form" data-testid="target-form">
        <label>
          詳細ジャンル
          <input name="detailCategory" defaultValue={product.detailCategory ?? ""} />
        </label>
        <label>
          ステータス
          <select name="wishlistStatus" defaultValue={product.wishlistStatus}>
            {(Object.keys(WISHLIST_STATUS_LABELS) as WishlistStatus[]).map((key) => (
              <option key={key} value={key}>
                {WISHLIST_STATUS_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          候補順位
          <input name="candidateRank" type="number" min="1" defaultValue={product.candidateRank} />
        </label>
        <label>
          写真URL
          <input name="imageUrl" type="url" defaultValue={product.imageUrl ?? ""} />
        </label>
        <label>
          商品URL
          <input name="productUrl" type="url" defaultValue={product.productUrl ?? ""} />
        </label>
        <label>
          購入予定月
          <input name="plannedPurchaseMonth" type="month" defaultValue={product.plannedPurchaseMonth ?? ""} />
        </label>
        <label>
          メモ
          <input name="purchaseNote" defaultValue={product.purchaseNote ?? ""} />
        </label>
        <details className="advanced-edit">
          <summary>詳細条件</summary>
          <div className="form-grid">
            <label>
              大カテゴリ
              <input name="category" defaultValue={product.category} />
            </label>
            <label>
              優先度
              <select name="priority" defaultValue={product.priority}>
                {(Object.keys(WISHLIST_PRIORITY_LABELS) as WishlistPriority[]).map((key) => (
                  <option key={key} value={key}>
                    {WISHLIST_PRIORITY_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              必須度
              <select name="mustHaveLevel" defaultValue={product.mustHaveLevel}>
                {(Object.keys(MUST_HAVE_LABELS) as MustHaveLevel[]).map((key) => (
                  <option key={key} value={key}>
                    {MUST_HAVE_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              購入先URL
              <input name="purchaseUrl" type="url" defaultValue={product.purchaseUrl ?? ""} />
            </label>
            <label>
              目標価格
              <input name="targetPrice" type="number" min="0" defaultValue={product.targetPrice ?? ""} data-testid="target-price-input" />
            </label>
            <label>
              ユーザー設定底値
              <input name="customFloorPrice" type="number" min="0" defaultValue={product.customFloorPrice ?? ""} data-testid="floor-price-input" />
            </label>
          </div>
        </details>
        <button type="submit" className="icon-button save-edit-button" data-testid="save-target-price">
          <Save size={16} />
          保存
        </button>
      </form>
    </section>
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
                    <td data-label="記録日時">{new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date(history.recordedAt))}</td>
                    <td data-label="店舗">{history.storeName}</td>
                    <td data-label="表示価格">{yen(history.listedPrice)}</td>
                    <td data-label="実質価格">{yen(history.effectivePrice)}</td>
                    <td data-label="在庫">{STOCK_STATUS_LABELS[history.stockStatus]}</td>
                    <td data-label="ラベル">
                      <div className="label-list">
                        {labels.map((label) => (
                          <span key={label} className="small-label">
                            {label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td data-label="底値判定">
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
        <div className="detail-title">
          <ProductVisual product={product} />
          <div>
            <p className="eyebrow">商品詳細</p>
            <h1>{product.name}</h1>
            <div className="label-list detail-labels">
              <span className="small-label">{product.category}</span>
              <span className="small-label">{product.detailCategory ?? "未分類"}</span>
              <span className="small-label">第{product.candidateRank}候補</span>
              <span className="small-label">{WISHLIST_STATUS_LABELS[product.wishlistStatus]}</span>
            </div>
          </div>
        </div>
        <div className="header-price">
          <span>現在の実質価格</span>
          <strong>{yen(calculatePriceMetrics(product, state.histories, state.settings, NOW).currentEffectivePrice)}</strong>
          <span>{currentLowestRelationship(product, state.histories, state.settings, NOW)}</span>
        </div>
      </div>
      <ProductPriceSettings product={product} onUpdated={onStateChange} />
      <details className="advanced-panel" data-testid="price-advanced-details">
        <summary data-testid="price-advanced-summary">価格推移・履歴を確認する</summary>
        <div className="advanced-panel-body">
          <PriceSummary product={product} state={state} />
          <EvaluationPanel product={product} state={state} />
          <ManualPriceForm product={product} state={state} onRecorded={onStateChange} />
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
          <HistoryTable product={product} state={state} onUpdated={onStateChange} />
        </div>
      </details>
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
          欲しいもの予算
          <input name="wishlistBudget" type="number" min="0" defaultValue={state.settings.wishlistBudget} />
        </label>
        <label>
          家計簿 月予算
          <input name="monthlyHouseholdBudget" type="number" min="0" defaultValue={state.settings.monthlyHouseholdBudget} />
        </label>
        <label>
          予算期間
          <select name="budgetPeriod" defaultValue={state.settings.budgetPeriod}>
            {(Object.keys(BUDGET_PERIOD_LABELS) as BudgetPeriod[]).map((key) => (
              <option key={key} value={key}>
                {BUDGET_PERIOD_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          トップの初期合計
          <select name="defaultBudgetViewMode" defaultValue={state.settings.defaultBudgetViewMode}>
            {(Object.keys(BUDGET_VIEW_LABELS) as BudgetViewMode[]).map((key) => (
              <option key={key} value={key}>
                {BUDGET_VIEW_LABELS[key]}の合計
              </option>
            ))}
          </select>
        </label>
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

function AppFooter({
  state,
  plannedSummary,
  onSignOut
}: {
  state: PriceAppState;
  plannedSummary: ReturnType<typeof calculateBudgetSummary>;
  onSignOut: () => void;
}) {
  const primarySummary = calculateBudgetSummary(state, "primary");
  return (
    <footer className="app-footer">
      <div className="app-status-footer" data-testid="app-status-footer">
        <span>
          <CheckCircle2 size={16} /> {CLOUD_MODE ? "クラウド同期" : "ローカルデモ"}
        </span>
        <span>
          <ShoppingCart size={16} /> 購入予定 {plannedSummary.itemCount}件
        </span>
        <span>
          <Wallet size={16} /> 購入予定 {yen(plannedSummary.total)} / {yen(plannedSummary.budget)}
        </span>
        <span>
          <Wallet size={16} /> 第一候補 {yen(primarySummary.total)} / {yen(primarySummary.budget)}
        </span>
        <span>
          <Clock3 size={16} /> 価格履歴 {state.histories.length}件
        </span>
        {CLOUD_MODE && (
          <button className="text-icon-button" onClick={onSignOut}>
            <LogOut size={16} /> ログアウト
          </button>
        )}
      </div>
      <p className="footnote">
        <TrendingDown size={16} />
        URLからの自動取得はまだ実装していません。各サイトの規約やAPI条件を確認したうえで、価格取得処理だけを後から接続できる設計にしています。
        <TrendingUp size={16} />
      </p>
    </footer>
  );
}

export function PriceApp() {
  const [state, setState] = useState<PriceAppState | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("overview");
  const [budgetMode, setBudgetMode] = useState<BudgetViewMode>("planned");
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  async function loadState() {
    setLoadingError(null);
    try {
      const nextState = await fetch("/api/state").then((response) => parseResponse<PriceAppState>(response));
      setState(nextState);
      setSelectedProductId(nextState.products[0]?.id ?? null);
      setBudgetMode(nextState.settings.defaultBudgetViewMode ?? "planned");
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

  function openProduct(productId: string) {
    setSelectedProductId(productId);
    setActiveTab("price");
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        try {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch {
          window.scrollTo(0, 0);
        }
      });
    }
  }

  if (authRequired) {
    return <AuthPanel onAuthenticated={() => void loadState()} />;
  }

  if (loadingError) {
    return <main className="app-shell error-state">{loadingError}</main>;
  }

  if (!state) {
    return <main className="app-shell">価格データを読み込んでいます。</main>;
  }

  const plannedSummary = calculateBudgetSummary(state, "planned");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Wishlist Planner</p>
          <h1>ほしい物リストと予算</h1>
        </div>
      </header>
      <AppTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <BudgetOverview state={state} mode={budgetMode} onModeChange={setBudgetMode} onOpenProduct={openProduct} onOpenLedger={() => setActiveTab("ledger")} />
      )}

      {activeTab === "wishlist" && (
        <div className="tab-page">
          <AddProductForm
            onCreated={(nextState) => {
              setState(nextState);
              setSelectedProductId(nextState.products[0]?.id ?? null);
            }}
          />
          <WishlistCategoryList state={state} onOpenProduct={openProduct} />
        </div>
      )}

      {activeTab === "ledger" && <HouseholdBook state={state} onStateChange={setState} />}

      {activeTab === "price" && (
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
      )}

      {activeTab === "settings" && (
        <GlobalSettings
          state={state}
          onUpdated={(nextState) => {
            setState(nextState);
            setBudgetMode(nextState.settings.defaultBudgetViewMode);
          }}
        />
      )}
      <AppFooter state={state} plannedSummary={plannedSummary} onSignOut={() => void signOut()} />
    </main>
  );
}

export default PriceApp;
