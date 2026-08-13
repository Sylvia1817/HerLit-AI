import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HerLit AI｜女性文学 AI 内容工作台",
  description: "面向个人创作者的女性文学内容生产工作台。",
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
