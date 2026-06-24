import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 工作图谱",
  description: "Local Pi-based AI work graph operating system"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="dark">
      <body>{children}</body>
    </html>
  );
}
