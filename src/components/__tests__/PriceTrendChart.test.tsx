import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import PriceTrendChart from "../PriceTrendChart";
import { createInitialState } from "@/domain/fixtures";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  LineChart: ({ children, data, onClick, onTouchStart }: { children: ReactNode; data: unknown[]; onClick?: (value: unknown) => void; onTouchStart?: (value: unknown) => void }) => (
    <div
      data-testid="line-chart"
      onClick={() => onClick?.({ activePayload: [{ payload: data[0] }] })}
      onTouchStart={() => onTouchStart?.({ activePayload: [{ payload: data[0] }] })}
    >
      {children}
    </div>
  ),
  CartesianGrid: () => <div data-testid="grid" />,
  Legend: () => <div data-testid="legend" />,
  Line: ({ name, dataKey }: { name: string; dataKey: string }) => <div data-testid={`line-${dataKey}`}>{name}</div>,
  ReferenceDot: ({ label, ...props }: { label?: { value?: string }; "data-testid"?: string }) => (
    <div data-testid={props["data-testid"] ?? "reference-dot"}>{label?.value}</div>
  ),
  ReferenceLine: ({ label }: { label?: { value?: string } }) => <div data-testid={`reference-line-${label?.value}`}>{label?.value}</div>,
  Tooltip: () => <div data-testid="graph-tooltip">ツールチップ</div>,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />
}));

describe("PriceTrendChart", () => {
  it("グラフツールチップを表示する", () => {
    const state = createInitialState();
    render(
      <PriceTrendChart
        product={state.products[0]}
        histories={state.histories}
        settings={state.settings}
        period="all"
        priceType="effective"
        storeViewMode="overall-lowest"
        selectedStores={[]}
        dailyRepresentativeMode="last"
        now={new Date("2026-07-05T04:00:00.000Z")}
      />
    );
    expect(screen.getByTestId("graph-tooltip")).toHaveTextContent("ツールチップ");
  });

  it("過去最安マーカーを表示する", () => {
    const state = createInitialState();
    render(
      <PriceTrendChart
        product={state.products[0]}
        histories={state.histories}
        settings={state.settings}
        period="all"
        priceType="effective"
        storeViewMode="overall-lowest"
        selectedStores={[]}
        dailyRepresentativeMode="last"
        now={new Date("2026-07-05T04:00:00.000Z")}
      />
    );
    expect(screen.getByTestId("lowest-marker")).toHaveTextContent("過去最安");
  });

  it("目標価格ラインと設定底値ラインを表示する", () => {
    const state = createInitialState();
    render(
      <PriceTrendChart
        product={state.products[0]}
        histories={state.histories}
        settings={state.settings}
        period="all"
        priceType="both"
        storeViewMode="overall-lowest"
        selectedStores={[]}
        dailyRepresentativeMode="last"
        now={new Date("2026-07-05T04:00:00.000Z")}
      />
    );
    expect(screen.getByTestId("reference-line-目標価格")).toBeInTheDocument();
    expect(screen.getByTestId("reference-line-設定底値")).toBeInTheDocument();
  });

  it("モバイルのタップ操作で価格詳細を固定表示する", () => {
    const state = createInitialState();
    render(
      <PriceTrendChart
        product={state.products[0]}
        histories={state.histories}
        settings={state.settings}
        period="all"
        priceType="effective"
        storeViewMode="overall-lowest"
        selectedStores={[]}
        dailyRepresentativeMode="last"
        now={new Date("2026-07-05T04:00:00.000Z")}
      />
    );
    fireEvent.click(screen.getByTestId("line-chart"));
    expect(screen.getByTestId("mobile-point-detail")).toHaveTextContent("選択中");
  });
});
