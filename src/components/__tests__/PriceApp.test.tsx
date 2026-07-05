import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PriceApp from "../PriceApp";
import { createInitialState } from "@/domain/fixtures";
import type { PriceAppState } from "@/domain/price-types";

vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ period, priceType, storeViewMode }: { period: string; priceType: string; storeViewMode: string }) => (
      <div data-testid="mock-chart">
        chart period:{period} priceType:{priceType} storeView:{storeViewMode}
      </div>
    )
}));

function mockFetch(state: PriceAppState) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/state")) {
        return new Response(JSON.stringify(state), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("/api/products/") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        const nextState = {
          ...state,
          products: state.products.map((product) => (product.id === "product-headphones" ? { ...product, targetPrice: Number(body.targetPrice) } : product))
        };
        return new Response(JSON.stringify(nextState), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(state), { status: 200, headers: { "Content-Type": "application/json" } });
    })
  );
}

describe("PriceApp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("期間切り替えができる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await screen.findByTestId("product-list");
    await userEvent.click(screen.getByTestId("period-30d"));
    expect(screen.getByTestId("mock-chart")).toHaveTextContent("period:30d");
  });

  it("価格種別切り替えができる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await screen.findByTestId("product-list");
    await userEvent.click(screen.getByTestId("price-type-both"));
    expect(screen.getByTestId("mock-chart")).toHaveTextContent("priceType:both");
  });

  it("店舗切り替えができる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await screen.findByTestId("product-list");
    await userEvent.selectOptions(screen.getByTestId("store-view-select"), "by-store");
    expect(screen.getByTestId("store-picker")).toHaveTextContent("Tokyo Audio");
    expect(screen.getByTestId("mock-chart")).toHaveTextContent("storeView:by-store");
  });

  it("履歴不足表示を出す", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await userEvent.click(await screen.findByTestId("product-card-product-coffee"));
    expect(screen.getByTestId("price-evaluation-label")).toHaveTextContent("履歴不足");
  });

  it("価格未設定表示を出す", async () => {
    const nextState = createInitialState();
    nextState.products[0].offers[0].listedPrice = null;
    nextState.products[0].offers[0].effectivePrice = null;
    mockFetch(nextState);
    render(<PriceApp />);
    await screen.findByTestId("product-list");
    expect(screen.getByTestId("price-evaluation-label")).toHaveTextContent("価格未設定");
  });

  it("価格更新前後の差額を表示する", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await screen.findByTestId("product-list");
    const listedPrice = screen.getByTestId("listed-price-input");
    await userEvent.clear(listedPrice);
    await userEvent.type(listedPrice, "23800");
    await waitFor(() => expect(screen.getByTestId("price-diff-preview")).toHaveTextContent("差額"));
    expect(screen.getByTestId("price-preview")).toHaveTextContent("変更前価格");
  });
});
