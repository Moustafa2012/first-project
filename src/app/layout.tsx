import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "بوابة شفاء",
  description: "بوابة رقمية لمتابعة الحالات الطبية",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
