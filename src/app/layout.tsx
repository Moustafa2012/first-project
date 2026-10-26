import type { Metadata, Viewport } from "next";
import "./globals.css";
import { i18n } from "@/lib/i18n";
import { getTheme, getTz } from "@/lib/auth";
import { TzSetter } from "@/components/ui/client";

export const metadata: Metadata = {
  title: { default: "بوابة شفاء · Shifa Portal", template: "%s · بوابة شفاء" },
  description: "سجل صحي إلكتروني متكامل لمتابعة الحالات الطبية ومشاركتها بأمان",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang, dir } = i18n();
  const theme = getTheme();
  return (
    <html lang={lang} dir={dir} data-theme={theme ?? undefined}>
      <body>
        <TzSetter current={getTz()} />
        {children}
      </body>
    </html>
  );
}
