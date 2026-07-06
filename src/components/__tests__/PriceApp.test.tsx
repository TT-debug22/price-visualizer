import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  let currentState = state;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/state")) {
        return new Response(JSON.stringify(currentState), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("/api/ledger") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        currentState = {
          ...currentState,
          ledgerEntries: [
            {
              id: "ledger-test",
              userId: currentState.userId,
              productId: null,
              title: body.title,
              amount: Number(body.amount),
              entryType: body.entryType,
              category: body.category,
              occurredOn: body.occurredOn,
              note: body.note,
              createdAt: "2026-07-06T00:00:00.000Z"
            },
            ...currentState.ledgerEntries
          ]
        };
        return new Response(JSON.stringify(currentState), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("/api/settings") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        currentState = {
          ...currentState,
          settings: {
            ...currentState.settings,
            ...body
          }
        };
        return new Response(JSON.stringify(currentState), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("/api/products/") && String(url).includes("/purchase") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const productId = String(url).split("/api/products/")[1]?.split("/")[0] ?? "product-headphones";
        const product = currentState.products.find((item) => item.id === productId)!;
        currentState = {
          ...currentState,
          products: currentState.products.map((item) => (item.id === productId ? { ...item, wishlistStatus: "purchased" } : item)),
          ledgerEntries: [
            {
              id: "ledger-purchase-test",
              userId: currentState.userId,
              productId,
              title: product.name,
              amount: Number(body.amount),
              entryType: "expense",
              category: body.category,
              occurredOn: body.occurredOn,
              note: body.note,
              createdAt: "2026-07-06T00:00:00.000Z"
            },
            ...currentState.ledgerEntries
          ]
        };
        return new Response(JSON.stringify({ state: currentState, message: "購入済みにして、家計簿へ記録しました" }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (String(url).includes("/api/products/") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        const productId = String(url).split("/api/products/")[1]?.split("/")[0] ?? "product-headphones";
        const nextState = {
          ...currentState,
          products: currentState.products.map((product) =>
            product.id === productId
              ? {
                  ...product,
                  ...("name" in body ? { name: body.name } : {}),
                  ...("targetPrice" in body ? { targetPrice: Number(body.targetPrice) } : {})
                }
              : product
          )
        };
        currentState = nextState;
        return new Response(JSON.stringify(nextState), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("/api/products/") && init?.method === "DELETE") {
        const productId = String(url).split("/api/products/")[1]?.split("/")[0] ?? "";
        currentState = {
          ...currentState,
          products: currentState.products.filter((product) => product.id !== productId),
          histories: currentState.histories.filter((history) => history.productId !== productId)
        };
        return new Response(JSON.stringify(currentState), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(currentState), { status: 200, headers: { "Content-Type": "application/json" } });
    })
  );
}

describe("PriceApp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function openPriceTab() {
    await userEvent.click(await screen.findByTestId("tab-price"));
    await screen.findByTestId("product-list");
  }

  async function openPriceDetails() {
    await userEvent.click(await screen.findByTestId("price-advanced-summary"));
  }

  it("購入予定の合計を初期表示し、第一候補の合計へ切り替えられる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    expect(await screen.findByText("購入予定の予算チェック")).toBeInTheDocument();
    const plannedList = screen.getByTestId("budget-product-list");
    expect(plannedList).toHaveTextContent("ノイズキャンセリングヘッドホン");
    expect(within(plannedList).queryByText("27インチ 4K モニター")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("budget-mode-primary"));
    expect(await screen.findByText("第一候補の予算チェック")).toBeInTheDocument();
    expect(screen.getByTestId("budget-product-list")).toHaveTextContent("27インチ 4K モニター");
  });

  it("補助ステータスをページ下部に表示する", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    const footer = await screen.findByTestId("app-status-footer");
    expect(footer).toHaveTextContent("ローカルデモ");
    expect(footer).toHaveTextContent("購入予定");
    expect(footer).toHaveTextContent("第一候補");
    expect(footer).toHaveTextContent("価格履歴");
  });

  it("家計簿タブで月次サマリーを確認し、支出を記録できる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await userEvent.click(await screen.findByTestId("tab-ledger"));
    expect(await screen.findByText("2026年7月の家計簿")).toBeInTheDocument();
    expect(screen.getByTestId("ledger-entry-list")).toHaveTextContent("スーパー");

    const form = screen.getByTestId("ledger-form");
    await userEvent.type(within(form).getByPlaceholderText("例: スーパー、給与、交通費"), "ランチ");
    await userEvent.type(within(form).getByPlaceholderText("例: 3200"), "1200");
    await userEvent.click(within(form).getByRole("button", { name: "家計簿に追加" }));

    expect(await screen.findByText("家計簿に記録しました")).toBeInTheDocument();
    expect(screen.getByTestId("ledger-entry-list")).toHaveTextContent("ランチ");
  });

  it("商品名を変更できる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await openPriceTab();
    const nameInput = await screen.findByTestId("product-name-input");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "新しいヘッドホン");
    await userEvent.click(screen.getByTestId("save-target-price"));
    expect(await screen.findByText("商品情報を保存しました")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新しいヘッドホン" })).toBeInTheDocument();
  });

  it("商品を削除できる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await openPriceTab();
    expect(await screen.findByTestId("product-card-product-headphones")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("delete-product"));
    await userEvent.click(screen.getByTestId("confirm-delete-product"));
    await waitFor(() => expect(screen.queryByTestId("product-card-product-headphones")).not.toBeInTheDocument());
  });

  it("購入済みにして家計簿へ記録できる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await openPriceTab();
    await userEvent.click(screen.getByTestId("record-purchase-button"));

    expect(await screen.findByText("購入済みにして、家計簿へ記録しました")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("tab-ledger"));
    expect(screen.getByTestId("ledger-entry-list")).toHaveTextContent("ノイズキャンセリングヘッドホン");
  });

  it("カテゴリ色を任意設定できる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await userEvent.click(await screen.findByTestId("tab-settings"));
    await userEvent.click(screen.getByLabelText("自動", { selector: "input[name='categoryColorAuto:オーディオ']" }));
    const colorInput = screen.getByTestId("category-color-オーディオ");
    fireEvent.change(colorInput, { target: { value: "#123456" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("判定条件を保存しました")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("tab-wishlist"));
    const swatch = document.querySelector("[style*='18, 52, 86']");
    expect(swatch).toBeTruthy();
  });

  it("期間切り替えができる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await openPriceTab();
    await openPriceDetails();
    await userEvent.click(screen.getByTestId("period-30d"));
    expect(screen.getByTestId("mock-chart")).toHaveTextContent("period:30d");
  });

  it("価格種別切り替えができる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await openPriceTab();
    await openPriceDetails();
    await userEvent.click(screen.getByTestId("price-type-both"));
    expect(screen.getByTestId("mock-chart")).toHaveTextContent("priceType:both");
  });

  it("店舗切り替えができる", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await openPriceTab();
    await openPriceDetails();
    await userEvent.selectOptions(screen.getByTestId("store-view-select"), "by-store");
    expect(screen.getByTestId("store-picker")).toHaveTextContent("Tokyo Audio");
    expect(screen.getByTestId("mock-chart")).toHaveTextContent("storeView:by-store");
  });

  it("履歴不足表示を出す", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await openPriceTab();
    await openPriceDetails();
    await userEvent.click(await screen.findByTestId("product-card-product-coffee"));
    expect(screen.getByTestId("price-evaluation-label")).toHaveTextContent("履歴不足");
  });

  it("価格未設定表示を出す", async () => {
    const nextState = createInitialState();
    nextState.products[0].offers[0].listedPrice = null;
    nextState.products[0].offers[0].effectivePrice = null;
    mockFetch(nextState);
    render(<PriceApp />);
    await openPriceTab();
    await openPriceDetails();
    expect(screen.getByTestId("price-evaluation-label")).toHaveTextContent("価格未設定");
  });

  it("価格更新前後の差額を表示する", async () => {
    mockFetch(createInitialState());
    render(<PriceApp />);
    await openPriceTab();
    await openPriceDetails();
    const listedPrice = screen.getByTestId("listed-price-input");
    await userEvent.clear(listedPrice);
    await userEvent.type(listedPrice, "23800");
    await waitFor(() => expect(screen.getByTestId("price-diff-preview")).toHaveTextContent("差額"));
    expect(screen.getByTestId("price-preview")).toHaveTextContent("変更前価格");
  });
});
