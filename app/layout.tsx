import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://quote-flow-blond.vercel.app"),
  title: "QuoteFlow | RFQ to Quotation PDF & Excel",
  description:
    "Convert RFQs into ready-to-review quotations using your approved price list. Review matches, then export PDF and Excel. One-time pricing from US$5.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: "QuoteFlow | RFQ to Quotation PDF & Excel",
    description:
      "Upload your RFQ and approved price list, review matches, and export your quotation in PDF and Excel. From US$5.",
    siteName: "QuoteFlow"
  },
  robots: { index: true, follow: true }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
