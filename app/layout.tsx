import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HerLit AI｜女性文学 AI 内容工作台",
  description: "HerLit 女性文学内容品牌背后的 AI 编辑系统。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
