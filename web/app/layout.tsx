import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Trafik — olycksdata på svenska vägar",
  description:
    "Historisk olycksdata som hjälper nervösa förare hitta tryggare rutter.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
