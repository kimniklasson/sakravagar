import type { Metadata } from "next";
import type { Viewport } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sakravagar.se"),
  title: "Säkra vägar – våga ut på vägarna",
  description:
    "Hitta och jämför rutter, trafikläge och vägtyp så att du kan välja en väg som känns möjlig.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Säkra vägar – våga ut på vägarna",
    description:
      "Hitta och jämför rutter, trafikläge och vägtyp så att du kan välja en väg som känns möjlig.",
    url: "/",
    siteName: "Säkra vägar",
    locale: "sv_SE",
    type: "website",
  },
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
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
