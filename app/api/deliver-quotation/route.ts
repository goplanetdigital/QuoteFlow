import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { buildQuote, type CatalogueItem, type RfqLine } from "../../../lib/quoteflow";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

function pdfEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function createPdf(lines: string[]) {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 42) pages.push(lines.slice(i, i + 42));
  const objects: string[] = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageIds: number[] = [];
  for (const page of pages) {
    const stream = page.map((line, i) => `BT /F1 10 Tf 40 ${780 - i * 17} Td (${pdfEscape(line)}) Tj ET`).join("\n");
    const streamId = objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => id + " 0 R").join(" ")}] /Count ${pageIds.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "utf8");
}
function safeCell(value: unknown) {
  const text = String(value ?? "");
  return /^[\s\x00-\x1f]*[=+@-]/.test(text) ? "'" + text : text;
}
export async function POST(request: NextRequest) {
  try {
    const { sessionId, format } = await request.json();
    const production = process.env.VERCEL_ENV === "production";
    if (!["pdf", "xlsx"].includes(format) || typeof sessionId !== "string" ||
        !/^cs_(?:live|test)_[A-Za-z0-9]+$/.test(sessionId) ||
        !sessionId.startsWith(production ? "cs_live_" : "cs_test_")) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: noStore });
    }
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    const db = process.env.DATABASE_URL?.trim();
    if (!key || !db || !(production ? /^(sk|rk)_live_/.test(key) : /^(sk|rk)_test_/.test(key))) {
      return NextResponse.json({ error: "Delivery unavailable" }, { status: 503, headers: noStore });
    }
    const stripe = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), {
      headers: { Authorization: "Bearer " + key }, cache: "no-store"
    });
    if (!stripe.ok) return NextResponse.json({ error: "Payment not found" }, { status: 403, headers: noStore });
    const session = await stripe.json();
    const fingerprint = session.metadata?.fingerprint;
    const count = Number(session.metadata?.itemCount);
    const version = session.metadata?.pricingVersion;
    const standard = version === "3" ? (count <= 20 ? 800 : count <= 100 ? 1800 : count <= 300 ? 3800 : 5900)
      : version === "2" ? (count <= 20 ? 500 : count <= 100 ? 1500 : count <= 300 ? 2900 : 4900)
      : (count <= 20 ? 1000 : count <= 100 ? 2900 : count <= 300 ? 5900 : 9900);
    const amount = production && session.metadata?.liveTest === "true" ? 100
      : !production && process.env.QUOTE_STRIPE_TEST_MODE === "true" ? 100 : standard;
    if (session.status !== "complete" || session.payment_status !== "paid" || session.mode !== "payment" ||
        session.currency !== "usd" || session.amount_total !== amount ||
        !Number.isSafeInteger(count) || count < 1 || count > 1000 ||
        typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint) ||
        session.client_reference_id !== fingerprint) {
      return NextResponse.json({ error: "Payment not eligible" }, { status: 403, headers: noStore });
    }
    const sql = neon(db);
    const rows = await sql`SELECT payload::text AS payload FROM quoteflow_quote_snapshots
      WHERE fingerprint = ${fingerprint} AND expires_at > now() LIMIT 1`;
    const payload = rows[0]?.payload ? JSON.parse(rows[0].payload) : null;
    if (typeof payload !== "string" || createHash("sha256").update(payload, "utf8").digest("hex") !== fingerprint) {
      return NextResponse.json({ error: "Original quotation unavailable. No replacement data generated." }, { status: 404, headers: noStore });
    }
    const quote = JSON.parse(payload) as { rfqLines: RfqLine[]; catalogue: CatalogueItem[];
      manualMatches?: Record<string, string>; meta: Record<string, string>; sourceName?: string };
    if (!Array.isArray(quote.rfqLines) || !Array.isArray(quote.catalogue) || !quote.meta) {
      return NextResponse.json({ error: "Invalid saved quotation" }, { status: 422, headers: noStore });
    }
    const base = buildQuote(quote.rfqLines, quote.catalogue);
    const lines = base.lines.map(line => {
      const code = quote.manualMatches?.[line.id];
      const item = code ? quote.catalogue.find(x => x.code === code) : null;
      return item ? { ...line, matchedCode: item.code, matchedDescription: item.description,
        approvedUnitPrice: item.approvedUnitPrice, lineTotal: item.approvedUnitPrice === null ? null : Number((item.approvedUnitPrice * line.quantity).toFixed(2)),
        reviewStatus: item.approvedUnitPrice === null ? "blocked" as const : "ready" as const } : line;
    });
    if (lines.length !== count || lines.some(x => x.reviewStatus !== "ready" || !Number.isFinite(x.lineTotal))) {
      return NextResponse.json({ error: "Saved quotation requires review" }, { status: 422, headers: noStore });
    }
    const subtotal = lines.reduce((sum, x) => sum + (x.lineTotal ?? 0), 0);
    const filename = (quote.meta.quoteNumber || "quotation").replace(/[^a-zA-Z0-9_-]/g, "_");
    if (format === "xlsx") {
      const XLSX = await import("xlsx");
      const rows = [
        ["QUOTATION"], ["Supplier", safeCell(quote.meta.supplierName)], ["Customer", safeCell(quote.meta.customerName)],
        ["Quote No.", safeCell(quote.meta.quoteNumber)], ["Currency", quote.meta.currency], ["Valid for", safeCell(quote.meta.validDays) + " days"],
        ["Source RFQ", safeCell(quote.sourceName)], [],
        ["No", "Item Code", "Description", "Quantity", "Unit", "Unit Price", "Total"],
        ...lines.map((x, i) => [i + 1, safeCell(x.matchedCode ?? x.code), safeCell(x.matchedDescription ?? x.description),
          x.quantity, safeCell(x.unit), x.approvedUnitPrice, x.lineTotal]),
        [], ["Approved subtotal", Number(subtotal.toFixed(2))], ["Notes", safeCell(quote.meta.notes)]
      ];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Quotation");
      const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
      return new NextResponse(new Uint8Array(bytes), { headers: { ...noStore,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"` } });
    }
    const values = [quote.meta.quoteNumber, quote.meta.supplierName, quote.meta.customerName, quote.meta.currency,
      quote.meta.notes, quote.meta.validDays, quote.sourceName,
      ...lines.flatMap(x => [x.code, x.description, x.matchedCode, x.matchedDescription, x.unit])];
    if (values.some(x => /[^\x20-\x7e]/.test(String(x ?? "")))) {
      return NextResponse.json({ error: "PDF contains unsupported characters" }, { status: 422, headers: noStore });
    }
    const printable = [
      "QUOTATION", "Supplier: " + quote.meta.supplierName, "Customer: " + quote.meta.customerName,
      "Quote No: " + quote.meta.quoteNumber, "Currency: " + quote.meta.currency,
      "Valid: " + quote.meta.validDays + " days", "Source: " + (quote.sourceName ?? ""), "",
      ...lines.flatMap((x, i) => [`${i + 1}. ${x.matchedCode ?? x.code} | ${x.matchedDescription ?? x.description}`,
        `   Qty ${x.quantity} ${x.unit} | Unit ${x.approvedUnitPrice} | Total ${x.lineTotal}`]),
      "", "Approved subtotal: " + quote.meta.currency + " " + subtotal.toFixed(2),
      "Notes: " + (quote.meta.notes ?? ""), "by ALLSET.co"
    ];
    const wrapped = printable.flatMap(x => x.length <= 92 ? [x] : x.match(/.{1,92}/g) ?? [""]);
    const bytes = createPdf(wrapped);
    return new NextResponse(new Uint8Array(bytes), { headers: { ...noStore,
      "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"` } });
  } catch {
    return NextResponse.json({ error: "File generation unavailable" }, { status: 503, headers: noStore });
  }
}
