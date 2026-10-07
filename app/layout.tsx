import "./globals.css";

export const metadata = {
  title: "QuoteFlow",
  description: "Turn RFQs into ready-to-review quotations."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
