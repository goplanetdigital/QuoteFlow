"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  buildQuote,
  CatalogueItem,
  demoCatalogue,
  detectCatalogueCurrency,
  demoRfq,
  parseCatalogueCsv,
  parseCsv,
  parsePdfText,
  RfqLine
} from "../../lib/quoteflow";

type QuoteMeta = {
  supplierName: string;
  customerName: string;
  quoteNumber: string;
  currency: string;
  validDays: string;
  notes: string;
};

async function fileToCsv(file: File) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".csv")) return file.text();

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return "";
    return XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheetName]);
  }

  return "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function defaultQuoteNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `QF-${y}${m}${day}-001`;
}

export default function QuoteWorkspace() {
  const [paymentStatus, setPaymentStatus] = useState<"unpaid" | "checking" | "paid">("unpaid");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [rfqLines, setRfqLines] = useState<RfqLine[]>(demoRfq);
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>(demoCatalogue);
  const [sourceName, setSourceName] = useState("Synthetic RFQ demo.csv");
  const [catalogueName, setCatalogueName] = useState("Built-in demo catalogue");
  const [manualMatches, setManualMatches] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(
    "Demo data loaded. Upload an RFQ and your approved catalogue."
  );
  const [meta, setMeta] = useState<QuoteMeta>({
    supplierName: "Your Company",
    customerName: "Customer",
    quoteNumber: defaultQuoteNumber(),
    currency: "USD",
    validDays: "30",
    notes: ""
  });

  const quote = useMemo(() => {
    const base = buildQuote(rfqLines, catalogue);
    const lines = base.lines.map((line) => {
      const selectedCode = manualMatches[line.id];
      if (!selectedCode) return line;

      const selected = catalogue.find((item) => item.code === selectedCode);
      if (!selected) return line;

      const price = selected.approvedUnitPrice;
      return {
        ...line,
        matchedCode: selected.code,
        matchedDescription: selected.description,
        approvedUnitPrice: price,
        lineTotal:
          price === null ? null : Number((price * line.quantity).toFixed(2)),
        reviewStatus: price === null ? ("blocked" as const) : ("ready" as const)
      };
    });

    const subtotal = lines.reduce(
      (sum, line) =>
        sum + (line.reviewStatus === "ready" ? line.lineTotal ?? 0 : 0),
      0
    );

    return {
      lines,
      subtotal: Number(subtotal.toFixed(2)),
      readyCount: lines.filter((line) => line.reviewStatus === "ready").length,
      reviewCount: lines.filter((line) => line.reviewStatus === "review").length,
      blockedCount: lines.filter((line) => line.reviewStatus === "blocked").length
    };
  }, [rfqLines, catalogue, manualMatches]);

  const pricing = useMemo(() => {
    const count = rfqLines.length;
    if (count === 0) return { label: "No RFQ items", amount: null as number | null };
    if (count <= 20) return { label: "Basic", amount: 10 };
    if (count <= 100) return { label: "Standard", amount: 29 };
    if (count <= 300) return { label: "Business", amount: 59 };
    if (count <= 1000) return { label: "Bulk", amount: 99 };
    return { label: "Enterprise - custom quote", amount: null as number | null };
  }, [rfqLines.length]);

  const readyLines = useMemo(
    () => quote.lines.filter((line) => line.reviewStatus === "ready"),
    [quote.lines]
  );

  const quotationPayload = JSON.stringify({ rfqLines, catalogue, manualMatches, meta, sourceName });
  async function quotationFingerprint() {
    const data = new TextEncoder().encode(quotationPayload);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  useEffect(() => {
    setPaymentStatus("unpaid");
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) return;
    const saved = sessionStorage.getItem("quoteflow_pending");
    if (!saved) return;
    try {
      const pending = JSON.parse(saved);
      if (pending.sessionId && pending.sessionId !== sessionId) return;
      const payload = pending.payload as string;
      if (!payload) return;
      const snapshot = JSON.parse(payload);
      setRfqLines(snapshot.rfqLines);
      setCatalogue(snapshot.catalogue);
      setManualMatches(snapshot.manualMatches);
      setMeta(snapshot.meta);
      setSourceName(snapshot.sourceName);
      setPaymentStatus("checking");
      const bytes = new TextEncoder().encode(payload);
      crypto.subtle.digest("SHA-256", bytes).then((hash) => {
        const fingerprint = Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
        return fetch("/api/verify-payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, fingerprint }) });
      }).then((response) => response.json()).then((result) => {
        setPaymentStatus(result.paid ? "paid" : "unpaid");
        if (!result.paid) setPaymentError("Payment not verified.");
      }).catch(() => { setPaymentStatus("unpaid"); setPaymentError("Could not verify payment."); });
    } catch { setPaymentStatus("unpaid"); }
  }, []);

  async function startCheckout() {
    if (!readyLines.length || !/^[A-Z]{3}$/.test(meta.currency)) {
      setPaymentError("Approve quotation lines and select a valid catalogue currency first.");
      return;
    }
    setCheckoutBusy(true);
    setPaymentError("");
    try {
      const fingerprint = await quotationFingerprint();
      const response = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemCount: rfqLines.length, fingerprint }) });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Checkout unavailable.");
      sessionStorage.setItem("quoteflow_pending", JSON.stringify({ payload: quotationPayload }));
      window.location.assign(result.url);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Checkout unavailable.");
      setCheckoutBusy(false);
    }
  }

  async function handleRfqUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setManualMatches({});
    const lower = file.name.toLowerCase();

    try {
      if (lower.endsWith(".pdf")) {
        setMessage("Extracting selectable text from PDF...");
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/extract-pdf", {
          method: "POST",
          body
        });
        const data = await response.json();

        if (!response.ok) {
          setMessage(data.error || "Could not extract this PDF.");
          return;
        }

        const parsed = parsePdfText(String(data.text ?? ""));
        if (!parsed.lines.length) {
          setMessage(parsed.warnings.join(" "));
          return;
        }

        setRfqLines(parsed.lines);
        setSourceName(file.name);
        setMessage(
          `Extracted ${parsed.lines.length} candidate RFQ lines from ${data.pages ?? "the"} PDF page(s). Review all lines before export.`
        );
        return;
      }

      const csv = await fileToCsv(file);
      if (!csv) {
        setMessage("Unsupported RFQ file. Use PDF, CSV, XLSX, or XLS.");
        return;
      }

      const parsed = parseCsv(csv);
      if (!parsed.length) {
        setMessage(
          "Could not detect RFQ rows. Expected columns such as code, description, quantity, and unit."
        );
        return;
      }

      setRfqLines(parsed);
      setSourceName(file.name);
      setMessage(
        `Loaded ${parsed.length} RFQ line${parsed.length === 1 ? "." : "s."}`
      );
    } catch {
      setMessage("Could not read that RFQ file. Please check its format.");
    }
  }

  async function handleCatalogueUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const csv = await fileToCsv(file);
      if (!csv) {
        setMessage("Unsupported catalogue file. Use CSV, XLSX, or XLS.");
        return;
      }

      const parsed = parseCatalogueCsv(csv);
      if (!parsed.length) {
        setMessage(
          "Could not detect catalogue rows. Expected description and price columns; code and unit are optional."
        );
        return;
      }

      const detectedCurrency = detectCatalogueCurrency(csv);
      setCatalogue(parsed);
      setManualMatches({});
      setMeta((current) => ({ ...current, currency: detectedCurrency ?? "" }));
      setCatalogueName(file.name);
      setMessage(
        `Loaded ${parsed.length} catalogue item${parsed.length === 1 ? "." : "s."} ${detectedCurrency ? `Detected currency: ${detectedCurrency}.` : "Currency could not be identified safely. Select the catalogue currency before exporting."} Matching has been recalculated.`
      );
    } catch {
      setMessage("Could not read that catalogue file. Please check its spreadsheet format.");
    }
  }

  function updateMeta(field: keyof QuoteMeta, value: string) {
    setMeta((current) => ({ ...current, [field]: value }));
  }

  function approveSuggested(lineId: string, matchedCode: string | null) {
    if (!matchedCode) return;
    setManualMatches((current) => ({ ...current, [lineId]: matchedCode }));
    setMessage("Match approved by reviewer. The line is now eligible for quotation if an approved price exists.");
  }

  function chooseCatalogueItem(lineId: string, code: string) {
    setManualMatches((current) => {
      const next = { ...current };
      if (!code) delete next[lineId];
      else next[lineId] = code;
      return next;
    });
  }

  function resetDemo() {
    setRfqLines(demoRfq);
    setCatalogue(demoCatalogue);
    setManualMatches({});
    setSourceName("Synthetic RFQ demo.csv");
    setCatalogueName("Built-in demo catalogue");
    setMessage("Synthetic RFQ and demo catalogue restored.");
  }

  async function downloadQuoteExcel() {
    if (paymentStatus !== "paid") { setPaymentError("Complete payment before downloading."); return; }
    if (!readyLines.length) {
      setMessage("No approved quotation lines are ready to export.");
      return;
    }

    const XLSX = await import("xlsx");
    const rows = readyLines.map((line, index) => ({
      No: index + 1,
      "Item Code": line.matchedCode ?? line.code,
      Description: line.matchedDescription ?? line.description,
      Quantity: line.quantity,
      Unit: line.unit,
      "Unit Price": line.approvedUnitPrice ?? "",
      Total: line.lineTotal ?? ""
    }));

    const details = [
      ["QUOTATION"],
      ["Supplier", meta.supplierName],
      ["Customer", meta.customerName],
      ["Quote No.", meta.quoteNumber],
      ["Currency", meta.currency],
      ["Valid for", `${meta.validDays} days`],
      ["Source RFQ", sourceName],
      [],
    ];

    const sheet = XLSX.utils.aoa_to_sheet(details);
    XLSX.utils.sheet_add_json(sheet, rows, { origin: "A9", skipHeader: false });
    XLSX.utils.sheet_add_aoa(
      sheet,
      [
        [],
        ["Approved subtotal", quote.subtotal],
        ["Notes", meta.notes || ""]
      ],
      { origin: -1 }
    );

    sheet["!cols"] = [
      { wch: 8 },
      { wch: 20 },
      { wch: 42 },
      { wch: 12 },
      { wch: 10 },
      { wch: 14 },
      { wch: 14 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Quotation");
    XLSX.writeFile(workbook, `${meta.quoteNumber || "quotation"}.xlsx`);
    setMessage("Quotation Excel generated from approved lines only.");
  }

  function downloadPdf() {
    if (paymentStatus !== "paid") { setPaymentError("Complete payment before downloading."); return; }
    if (!/^[A-Z]{3}$/.test(meta.currency)) {
      setMessage("Select the catalogue currency before downloading PDF.");
      return;
    }
    if (!readyLines.length) {
      setMessage("No approved quotation lines are ready to export.");
      return;
    }

    // Generate the PDF directly as a downloadable file, without pop-ups or print dialogs.
    const ascii = (value: unknown) => String(value ?? "").replace(/[^\x20-\x7E]/g, "?");
    const pdfEscape = (value: unknown) => ascii(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
    const pages: string[][] = [[]];
    let y = 790;
    const add = (value: unknown, x = 45, size = 10) => {
      if (y < 55) {
        pages.push([]);
        y = 790;
      }
      pages[pages.length - 1].push(`BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfEscape(value)}) Tj ET`);
      y -= size + 8;
    };
    const wrap = (value: unknown, limit = 85) => {
      const words = ascii(value).split(/\s+/);
      const result: string[] = [];
      let current = "";
      for (const word of words) {
        if (current && (current + " " + word).length > limit) {
          result.push(current);
          current = word;
        } else {
          current = current ? current + " " + word : word;
        }
        while (current.length > limit) {
          result.push(current.slice(0, limit));
          current = current.slice(limit);
        }
      }
      if (current) result.push(current);
      return result.length ? result : [""];
    };
    // Draw a clean, printable A4 quotation with aligned columns and repeated page headings.
    const drawText = (value: unknown, x: number, atY: number, size = 10) => {
      pages[pages.length - 1].push(`BT /F1 ${size} Tf 1 0 0 1 ${x} ${atY} Tm (${pdfEscape(value)}) Tj ET`);
    };
    const rule = (atY: number) => {
      pages[pages.length - 1].push(`0.82 0.85 0.89 RG 0.6 w 45 ${atY} m 550 ${atY} l S`);
    };
    const rightText = (value: unknown, rightX: number, atY: number, size = 9) => {
      // Helvetica's average glyph width is approximated to keep numbers aligned.
      const width = ascii(value).split("").reduce((sum, char) => sum + (char === " " ? 0.28 : /[il1.,]/.test(char) ? 0.28 : /[MW@]/.test(char) ? 0.85 : 0.55), 0) * size;
      drawText(value, rightX - width, atY, size);
    };
    const heading = (continuation = false) => {
      drawText("QUOTATION", 45, 790, 22);
      rightText(meta.quoteNumber, 550, 796, 10);
      rule(774);
      drawText("FROM", 45, 750, 9);
      drawText(meta.supplierName, 45, 732, 12);
      drawText("BILL TO", 310, 750, 9);
      drawText(meta.customerName, 310, 732, 12);
      drawText("VALIDITY", 45, 704, 9);
      drawText(meta.validDays + " days", 45, 688, 10);
      drawText("CURRENCY", 310, 704, 9);
      drawText(meta.currency, 310, 688, 10);
      drawText("SOURCE", 45, 662, 9);
      drawText(sourceName, 45, 646, 9);
      if (continuation) rightText("CONTINUED", 550, 646, 9);
      rule(626);
      drawText("#", 48, 607, 9);
      drawText("ITEM / DESCRIPTION", 78, 607, 9);
      rightText("QTY", 368, 607, 9);
      rightText("UNIT PRICE", 447, 607, 9);
      rightText("TOTAL", 548, 607, 9);
      rule(595);
      y = 576;
    };
    heading();
    readyLines.forEach((line, index) => {
      const description = line.matchedDescription ?? line.description;
      const item = `${line.matchedCode ?? line.code} - ${description}`;
      const wrapped = wrap(item, 40);
      const rowHeight = Math.max(42, wrapped.length * 14 + 12);
      if (y - rowHeight < 105) {
        pages.push([]);
        heading(true);
      }
      drawText(index + 1, 48, y, 9);
      wrapped.forEach((part, partIndex) => drawText(part, 78, y - partIndex * 14, 9));
      rightText(`${line.quantity} ${line.unit}`, 368, y, 9);
      rightText((line.approvedUnitPrice ?? 0).toFixed(2), 447, y, 9);
      rightText((line.lineTotal ?? 0).toFixed(2), 548, y, 9);
      y -= rowHeight;
      rule(y + 8);
      y -= 7;
    });
    if (y < 135) {
      pages.push([]);
      heading(true);
    }
    y -= 15;
    drawText("APPROVED SUBTOTAL", 305, y, 10);
    rightText(`${meta.currency} ${quote.subtotal.toFixed(2)}`, 548, y, 13);
    y -= 32;
    if (meta.notes) {
      const noteLines = wrap(meta.notes, 88);
      if (y - noteLines.length * 14 < 75) {
        pages.push([]);
        heading(true);
      }
      drawText("TERMS & NOTES", 45, y, 10);
      y -= 20;
      noteLines.forEach((part) => { drawText(part, 45, y, 9); y -= 14; });
    }
    pages.forEach((commands, index) => {
      commands.push(`0.82 0.85 0.89 RG 0.6 w 45 49 m 550 49 l S`);
      commands.push(`BT /F1 8 Tf 1 0 0 1 45 34 Tm (QuoteFlow - approved catalogue prices only) Tj ET`);
      commands.push(`BT /F1 8 Tf 1 0 0 1 490 34 Tm (Page ${index + 1} of ${pages.length}) Tj ET`);
    });

    const objects: string[] = [];
    const put = (value: string) => { objects.push(value); return objects.length; };
    const catalogId = put("");
    const pagesId = put("");
    const fontId = put("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const pageIds: number[] = [];
    for (const commands of pages) {
      const stream = commands.join("\n") + "\n";
      const contentId = put(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
      const pageId = put(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    }
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => id + " 0 R").join(" ")}] /Count ${pageIds.length} >>`;
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((obj, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { pdf += String(offset).padStart(10, "0") + " 00000 n \n"; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const blob = new Blob([pdf], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = (meta.quoteNumber.replace(/[^a-zA-Z0-9_-]/g, "_") || "quotation") + ".pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setMessage("Quotation PDF downloaded. Only approved lines were included.");
  }

  return (
    <section id="workspace" className="workspace">
      <div className="workspace-head">
        <div>
          <div className="eyebrow">MVP-03 · end-to-end quotation workflow</div>
          <h2>RFQ to quotation</h2>
          <p className="muted">RFQ: {sourceName}</p>
          <p className="muted">Catalogue: {catalogueName} · {catalogue.length} items</p>
        </div>

        <div className="workspace-actions">
          <button className="secondary-button" type="button" onClick={resetDemo}>Reset demo</button>
          <label className="upload-button secondary-upload">
            Upload catalogue
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleCatalogueUpload}
            />
          </label>
          <label className="upload-button">
            Upload RFQ
            <input
              type="file"
              accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleRfqUpload}
            />
          </label>
        </div>
      </div>

      <div className="notice">{message}</div>

      <div className="input-status-grid">
        <div><span>RFQ source</span><strong>{rfqLines.length} lines</strong><small>{sourceName}</small></div>
        <div><span>Approved catalogue</span><strong>{catalogue.length} items</strong><small>{catalogueName}</small></div>
      </div>

      <div className="quote-meta">
        <label>Supplier<input value={meta.supplierName} onChange={(e) => updateMeta("supplierName", e.target.value)} /></label>
        <label>Customer<input value={meta.customerName} onChange={(e) => updateMeta("customerName", e.target.value)} /></label>
        <label>Quote no.<input value={meta.quoteNumber} onChange={(e) => updateMeta("quoteNumber", e.target.value)} /></label>
        <label>Currency<input value={meta.currency} onChange={(e) => updateMeta("currency", e.target.value.toUpperCase())} maxLength={6} /></label>
        <label>Valid days<input value={meta.validDays} onChange={(e) => updateMeta("validDays", e.target.value.replace(/[^0-9]/g, ""))} /></label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source item</th><th>Description</th><th>Qty</th><th>Catalogue match</th>
              <th>Approved price</th><th>Total</th><th>Status / review</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((row) => (
              <tr key={row.id}>
                <td>{row.code || "—"}</td>
                <td>
                  <strong>{row.description}</strong>
                  {row.matchedDescription && row.matchedDescription !== row.description ? <small>Matched: {row.matchedDescription}</small> : null}
                </td>
                <td>{row.quantity} {row.unit}</td>
                <td>
                  <span className={"match " + row.matchStatus}>{row.matchStatus}</span>
                  {row.matchedCode ? <small>{row.matchedCode}</small> : null}
                </td>
                <td>{row.approvedUnitPrice === null ? "No approved price" : `${meta.currency} ${row.approvedUnitPrice.toFixed(2)}`}</td>
                <td>{row.lineTotal === null ? "—" : `${meta.currency} ${row.lineTotal.toFixed(2)}`}</td>
                <td>
                  <span className={"status " + row.reviewStatus}>{row.reviewStatus}</span>
                  {row.reviewStatus !== "ready" ? (
                    <div className="review-controls">
                      {row.reviewStatus === "review" && row.matchedCode ? (
                        <button type="button" className="mini-button" onClick={() => approveSuggested(row.id, row.matchedCode)}>
                          Approve suggested
                        </button>
                      ) : null}
                      <select value={manualMatches[row.id] ?? ""} onChange={(e) => chooseCatalogueItem(row.id, e.target.value)}>
                        <option value="">Choose catalogue item</option>
                        {catalogue.map((item) => (
                          <option key={item.code + item.description} value={item.code}>
                            {item.code || "No code"} · {item.description} {item.approvedUnitPrice === null ? "(no price)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : manualMatches[row.id] ? <small>Reviewer approved</small> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="summary">
        <div><strong>{quote.lines.length}</strong><span>RFQ lines</span></div>
        <div><strong>{quote.readyCount}</strong><span>Ready</span></div>
        <div><strong>{quote.reviewCount}</strong><span>Needs review</span></div>
        <div><strong>{quote.blockedCount}</strong><span>Blocked</span></div>
        <div className="subtotal"><span>Approved subtotal</span><strong>{meta.currency} {quote.subtotal.toFixed(2)}</strong></div>
      </div>

      <label className="notes-field">
        Quotation notes
        <textarea value={meta.notes} onChange={(e) => updateMeta("notes", e.target.value)} placeholder="Payment terms, delivery notes, exclusions, or other quotation notes." />
      </label>

      <div className="guardrail">
        <strong>QuoteFlow export pricing (USD)</strong>
        <span>{rfqLines.length} RFQ item(s) · {pricing.label} · {pricing.amount === null ? "Contact us for pricing" : `USD ${pricing.amount.toFixed(2)} per quotation`}. One payment will cover PDF and Excel of the same quotation. Stripe payment is required to unlock exports.</span>
      </div>

      <div className="export-row">
        <div>
          <strong>Stripe checkout · {process.env.NEXT_PUBLIC_QUOTE_TEST_MODE === "true" ? "USD 1.00 TEST" : "USD " + (pricing.amount?.toFixed(2) ?? "custom")}</strong>
          <span>{paymentStatus === "paid" ? "Payment verified. PDF and Excel unlocked." : paymentStatus === "checking" ? "Verifying payment..." : "Pay to unlock both downloads."}</span>
          {paymentError ? <span role="alert">{paymentError}</span> : null}
        </div>
        <button type="button" onClick={startCheckout} disabled={checkoutBusy || paymentStatus !== "unpaid" || pricing.amount === null}>{checkoutBusy ? "Opening Stripe..." : "Pay with Stripe"}</button>
      </div>
      <div className="export-row">
        <div>
          <strong>Generate quotation</strong>
          <span>Only Ready lines are included. Review and Blocked lines remain excluded.</span>
        </div>
        <div className="export-actions">
          <button type="button" className="secondary-button" onClick={downloadQuoteExcel} disabled={paymentStatus !== "paid"}>Download Excel</button>
          <button type="button" onClick={downloadPdf} disabled={paymentStatus !== "paid"}>Download PDF</button>
        </div>
      </div>

      <div className="guardrail">
        <strong>QuoteFlow safety rule</strong>
        <span>PDF extraction must be reviewed. Missing prices and uncertain matches never enter the quotation until a reviewer resolves them.</span>
      </div>
    </section>
  );
}
