import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "دفتر کار روزانه",
  description: "دموی عمومی مشاهده‌ی زمان‌های در دسترس و ثبت درخواست وقت رئیس اداره",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
