import type { Metadata } from "next";
import type { Viewport } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Trafik — olycksdata på svenska vägar",
  description:
    "Historisk olycksdata som hjälper nervösa förare hitta tryggare rutter.",
  icons: {
    icon: "/logo/sakravagar_symbol.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
