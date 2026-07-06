"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { ChartPoint, ChartPeriod, DailyRepresentativeMode, PriceHistory, PriceType, Product, StoreViewMode, UserPriceSettings } from "@/domain/price-types";
import { STOCK_STATUS_LABELS } from "@/domain/price-types";
import { calculateChange, signedYen, yen } from "@/domain/price-calculations";
import { buildChartData, calculatePriceMetrics, getStoreNames, productHistories } from "@/domain/price-analytics";

interface PriceTrendChartProps {
  product: Product;
  histories: PriceHistory[];
  settings: UserPriceSettings;
  period: ChartPeriod;
  priceType: PriceType;
  storeViewMode: StoreViewMode;
  selectedStores: string[];
  dailyRepresentativeMode: DailyRepresentativeMode;
  now?: Date;
}

const SERIES_COLORS = ["#176b87", "#9a3412", "#166534", "#7c3aed", "#be123c", "#0f766e"];

function useCompactChartLayout(): boolean {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setIsCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isCompact;
}

function findPreviousRecord(records: PriceHistory[], target: PriceHistory): PriceHistory | null {
  const sorted = records
    .filter((record) => record.productId === target.productId && record.offerId === target.offerId)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const index = sorted.findIndex((record) => record.id === target.id);
  return index > 0 ? sorted[index - 1] : null;
}

function PriceTooltip({
  active,
  payload,
  productRecords,
  lowest
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  productRecords: PriceHistory[];
  lowest: PriceHistory | null;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const point = payload[0].payload;
  const records = point.records.length > 0 ? point.records : [];

  return (
    <div className="chart-tooltip" data-testid="graph-tooltip">
      <strong>{point.date}</strong>
      {records.map((record) => {
        const previous = findPreviousRecord(productRecords, record);
        const previousChange = calculateChange(record.effectivePrice, previous?.effectivePrice ?? null);
        const lowestDiff = record.effectivePrice != null && lowest?.effectivePrice != null ? record.effectivePrice - lowest.effectivePrice : null;
        return (
          <div className="tooltip-record" key={record.id}>
            <div>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.recordedAt))}</div>
            <div>店舗: {record.storeName}</div>
            <div>表示価格: {yen(record.listedPrice)} / 送料: {yen(record.shippingFee)}</div>
            <div>値引: {yen(record.discountAmount + record.couponDiscount)} / ポイント: {yen(record.pointValue)}</div>
            <div>実質価格: {yen(record.effectivePrice)}</div>
            <div>在庫状況: {STOCK_STATUS_LABELS[record.stockStatus]}</div>
            <div>前回記録との差額: {signedYen(previousChange.amount)}</div>
            <div>過去最安値との差額: {signedYen(lowestDiff)}</div>
          </div>
        );
      })}
    </div>
  );
}

function getPointFromInteraction(state: unknown): ChartPoint | null {
  const candidate = state as { activePayload?: Array<{ payload?: ChartPoint }> };
  return candidate.activePayload?.[0]?.payload ?? null;
}

export function PriceTrendChart({
  product,
  histories,
  settings,
  period,
  priceType,
  storeViewMode,
  selectedStores,
  dailyRepresentativeMode,
  now = new Date()
}: PriceTrendChartProps) {
  const [selectedPoint, setSelectedPoint] = useState<ChartPoint | null>(null);
  const isCompact = useCompactChartLayout();
  const metrics = useMemo(() => calculatePriceMetrics(product, histories, settings, now), [product, histories, settings, now]);
  const productRecords = useMemo(() => productHistories(histories, product.id), [histories, product.id]);
  const chartData = useMemo(
    () =>
      buildChartData(product, histories, {
        period,
        priceType,
        storeViewMode,
        selectedStores,
        dailyRepresentativeMode,
        now
      }),
    [dailyRepresentativeMode, histories, now, period, priceType, product, selectedStores, storeViewMode]
  );
  const storeNames = useMemo(() => getStoreNames(product, histories), [product, histories]);
  const lowestRecord = metrics.allTimeLowestEffective;
  const lowestPoint = lowestRecord ? chartData.find((point) => point.records.some((record) => record.id === lowestRecord.id)) : null;
  const currentPoint = chartData.at(-1) ?? null;
  const yValues = chartData.flatMap((point) =>
    Object.entries(point)
      .filter(([key, value]) => (key.startsWith("effective") || key.startsWith("listed")) && typeof value === "number")
      .map(([, value]) => Number(value))
  );
  const references = [product.targetPrice, product.customFloorPrice, metrics.average90Days].filter((value): value is number => typeof value === "number");
  const minY = Math.min(...yValues, ...references);
  const maxY = Math.max(...yValues, ...references);
  const padding = Number.isFinite(minY) && Number.isFinite(maxY) ? Math.max(500, (maxY - minY) * 0.12) : 1000;

  const handleSelect = (state: unknown) => {
    const point = getPointFromInteraction(state);
    if (point) setSelectedPoint(point);
  };

  if (chartData.length === 0) {
    return (
      <div className="empty-chart" data-testid="history-empty">
        この期間には有効な価格履歴がありません。欠損期間を価格線として補間せず、実在する記録だけを表示します。
      </div>
    );
  }

  const chartSummary = `価格推移: ${chartData.length}点。現在の実質価格は${yen(metrics.currentEffectivePrice)}、過去最安は${yen(
    lowestRecord?.effectivePrice
  )}です。`;

  return (
    <div className="chart-shell" data-testid="price-chart-shell">
      <p className="sr-only">{chartSummary}</p>
      <ResponsiveContainer width="100%" height={isCompact ? 270 : 360}>
        <LineChart
          data={chartData}
          margin={isCompact ? { top: 12, right: 8, left: 0, bottom: 4 } : { top: 20, right: 26, left: 10, bottom: 12 }}
          onClick={handleSelect}
          onTouchStart={handleSelect}
          accessibilityLayer
          role="img"
          title="価格推移グラフ"
          desc={chartSummary}
        >
          <CartesianGrid stroke="#d8dee6" strokeDasharray="4 4" />
          <XAxis dataKey="date" minTickGap={isCompact ? 36 : 24} tick={{ fontSize: isCompact ? 10 : 12 }} tickFormatter={(value) => String(value).slice(5).replace("-", "/")} />
          <YAxis
            width={isCompact ? 50 : 76}
            tick={{ fontSize: isCompact ? 10 : 12 }}
            tickFormatter={(value) => `${Math.round(Number(value)).toLocaleString("ja-JP")}円`}
            domain={[Math.max(0, minY - padding), maxY + padding]}
          />
          <Tooltip content={<PriceTooltip productRecords={productRecords} lowest={lowestRecord} />} />
          <Legend
            height={isCompact ? 46 : undefined}
            wrapperStyle={isCompact ? { fontSize: 11, lineHeight: "18px", paddingTop: 4 } : undefined}
          />

          {product.targetPrice != null && (
            <ReferenceLine y={product.targetPrice} stroke="#0f766e" strokeDasharray="7 4" label={{ value: isCompact ? "目標" : "目標価格", position: "insideTopRight" }} />
          )}
          {product.customFloorPrice != null && (
            <ReferenceLine y={product.customFloorPrice} stroke="#9a3412" strokeDasharray="3 3" label={{ value: isCompact ? "底値" : "設定底値", position: "insideBottomRight" }} />
          )}
          {metrics.average90Days != null && (
            <ReferenceLine y={metrics.average90Days} stroke="#475569" strokeDasharray="2 6" label={{ value: isCompact ? "平均" : "90日平均", position: "insideTopLeft" }} />
          )}

          {storeViewMode === "by-store"
            ? storeNames
                .filter((storeName) => selectedStores.includes(storeName))
                .slice(0, 6)
                .flatMap((storeName, index) => {
                  const lines = [];
                  if (priceType === "effective" || priceType === "both") {
                    lines.push(
                      <Line
                        key={`effective:${storeName}`}
                        type="linear"
                        name={`${storeName} 実質`}
                        dataKey={`effective:${storeName}`}
                        stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                        strokeWidth={2.5}
                        connectNulls={false}
                        dot={{ r: 4 }}
                        activeDot={{ r: 7 }}
                      />
                    );
                  }
                  if (priceType === "listed" || priceType === "both") {
                    lines.push(
                      <Line
                        key={`listed:${storeName}`}
                        type="linear"
                        name={`${storeName} 表示`}
                        dataKey={`listed:${storeName}`}
                        stroke={SERIES_COLORS[(index + 2) % SERIES_COLORS.length]}
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        connectNulls={false}
                        dot={{ r: 3 }}
                      />
                    );
                  }
                  return lines;
                })
            : null}

          {storeViewMode !== "by-store" && (priceType === "effective" || priceType === "both") && (
            <Line
              type="linear"
              name="実質価格"
              dataKey="effectivePrice"
              stroke="#176b87"
              strokeWidth={3}
              connectNulls={false}
              dot={{ r: 4 }}
              activeDot={{ r: 8 }}
            />
          )}
          {storeViewMode !== "by-store" && (priceType === "listed" || priceType === "both") && (
            <Line
              type="linear"
              name="表示価格"
              dataKey="listedPrice"
              stroke="#9a3412"
              strokeWidth={2.5}
              strokeDasharray="6 4"
              connectNulls={false}
              dot={{ r: 4 }}
              activeDot={{ r: 7 }}
            />
          )}
          {lowestPoint && lowestRecord?.effectivePrice != null && (
            <ReferenceDot
              x={lowestPoint.date}
              y={lowestRecord.effectivePrice}
              r={8}
              fill="#facc15"
              stroke="#713f12"
              strokeWidth={2}
              label={{ value: isCompact ? "最安" : "過去最安", position: "top" }}
              data-testid="lowest-marker"
            />
          )}
          {currentPoint?.effectivePrice != null && (
            <ReferenceDot
              x={currentPoint.date}
              y={currentPoint.effectivePrice}
              r={7}
              fill="#0f766e"
              stroke="#042f2e"
              strokeWidth={2}
              label={{ value: "現在", position: "bottom" }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <div className="selected-point" data-testid="mobile-point-detail" aria-live="polite">
        {selectedPoint ? (
          <>
            <strong>選択中: {selectedPoint.date}</strong>
            <span>
              {selectedPoint.records.map((record) => `${record.storeName} ${yen(record.effectivePrice)}`).join(" / ")}
            </span>
          </>
        ) : (
          <span>グラフ上の点をタップすると詳細を固定表示します。</span>
        )}
      </div>
    </div>
  );
}

export default PriceTrendChart;
