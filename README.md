# ほしい物リスト・予算・価格推移デモ

このディレクトリは、ほしい物リストを中心に、購入予定・第一候補の合計額、予算内かどうか、商品ごとの価格推移と底値判定をまとめて確認する Next.js 実装です。対象プロジェクトが空だったため、`work/price-visualizer` に独立したアプリとして作っています。

外出先から iPhone で確認できるように、Supabase Auth/Postgres と Vercel デプロイに対応しました。Supabase 環境変数がある場合はクラウド保存、ない場合は従来どおりローカル JSON のデモ保存で動きます。

## 実装内容

- トップ画面で「購入予定」または「第一候補」の合計額を切り替え表示
- 購入予定の合計を初期表示し、予算・合計・残額/超過額を確認
- 詳細ジャンルごとのカテゴリ分け、候補順位、優先度、必須度、購入予定月
- 欲しいもの、候補比較、価格詳細、設定をタブで分離
- 商品URL・購入先URLを保存し、将来の価格取得元に接続しやすい構造
- 表示価格と実質価格を分けた商品一覧、商品詳細、価格サマリー
- 価格更新フォームと「現在価格を記録」ボタン
- 同一価格の自動重複保存防止と、手動記録時の同一価格保存
- 価格履歴、除外設定、底値ラベル、30日/90日最安、90日平均
- 期間、価格種別、店舗表示、日単位代表価格を切り替える折れ線グラフ
- ダッシュボードの底値圏内、目標価格以下、値下がり、値上がり、履歴不足
- Supabase 移行用 SQL と RLS ポリシー
- Supabase Auth によるログインとユーザー別データ分離
- Vercel に置ける環境変数ベースのクラウド保存
- 将来の月次・年次家計簿用 `ledger_entries` テーブル

初期版は EC サイトへの自動アクセスを実装していません。手動更新、URL 取得、定期確認、外部 API、拡張機能などは `recordProductPrice` と価格評価ロジックを共通利用する構造にしています。

## グラフライブラリ

Recharts を採用しました。

- 公式サイトで React コンポーネント型のチャートライブラリとして公開されています: https://recharts.github.io/
- 公式 GitHub で React/D3 ベース、SVG、宣言的コンポーネント、MIT ライセンスが確認できます: https://github.com/recharts/recharts
- 2026-07-04 時点で v3.9.2 が最新リリースとして表示され、保守継続を確認しました。
- LineChart、複数系列、Tooltip、ReferenceLine、ReferenceDot、ResponsiveContainer、タッチイベント、TypeScript 実装に対応しています。

制限事項:

- Recharts は描画そのものを SVG に任せるため、大量の履歴を全点表示する場合はサンプリングや期間制限が必要です。
- SSR ではなく `next/dynamic` の Client Component として遅延読み込みしています。
- アクセシビリティ層と代替要約を入れていますが、詳細なキーボード探索 UI は今後の拡張余地があります。

## ローカル実行

```bash
pnpm install
pnpm dev --hostname 127.0.0.1 --port 3100
```

Supabase を使う場合は `.env.example` を `.env.local` に写し、`NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定します。

## 外出先対応のデプロイ

推奨構成は `Next.js + Vercel + Supabase` です。

1. Supabase で新規プロジェクトを作成します。
2. `supabase/migrations/20260705000000_price_cloud_schema.sql` を Supabase SQL Editor で実行します。
3. Supabase Auth の Email provider を有効にします。
4. Vercel にこのアプリをデプロイします。
5. Vercel の Environment Variables に以下を設定します。
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
6. Supabase Auth の Site URL に Vercel の公開 URL を設定します。
7. Supabase Auth の Redirect URLs に `https://your-app.vercel.app/auth/callback` を追加します。

デプロイ後はログイン必須になり、商品・出品情報・価格履歴・判定設定は Supabase の RLS によりユーザーごとに分離されます。

既に旧SQLを実行済みのSupabaseへ今回の欲しいものリスト機能を追加する場合は、追加で `supabase/migrations/20260706000000_wishlist_budget_schema.sql` を Supabase SQL Editor で実行してください。

## Supabase テーブル

- `products`: 商品、詳細ジャンル、候補順位、購入予定ステータス、目標価格、設定底値、計算対象出品情報
- `offers`: 店舗別の現在価格、実質価格、自動取得用メタデータ
- `price_histories`: 表示価格、送料、値引、ポイント、実質価格、在庫、除外設定
- `user_price_settings`: 予算、予算期間、初期合計表示、最安圏内、大きな値下がり、グラフ初期設定
- `ledger_entries`: 将来の月次・年次家計簿用の支出/収入記録

すべてのテーブルに RLS を設定し、`auth.uid()` と `user_id` が一致する行だけ操作できます。

## 検証

```bash
pnpm test
pnpm test:e2e
pnpm build
```

## データ

デモデータは `.data/price-state.json` に保存されます。E2E は `/api/test/reset` で初期化してから実行します。
