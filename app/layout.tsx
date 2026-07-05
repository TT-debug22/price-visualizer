import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "商品価格の可視化",
  description: "現在価格、価格推移、底値判定を確認するデモアプリ"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
