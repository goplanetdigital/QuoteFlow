"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  buildQuote,
  CatalogueItem,
  demoCatalogue,
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
  const [rfqLines, setRfqLines] = useState<RfqLine[]>(demoRfq);
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>(demoCatalogue);
  const [sourceName, setSourceName] = useState("Synthetic RFQ demo.csv");
  const [catalogueName, setCatalogueName] = useState("Built-in demo catalogue");
  const [manualMatches, setManualMatches] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(
    "Demo data loaded. Upload an RFQ and your approved catalogue."
  );
  const [exportUnlocked, setExportUnlocked] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
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

  const readyLines = useMemo(
    () => quote.lines.filter((line) => line.reviewStatus === "ready"),
    [quote.lines]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const paid = params.get("paid");

    if (paid === "1" && sessionId) {
      fetch("/api/verify-session?session_id=" + encodeURIComponent(sessionId))
        .then((response) => response.json())
        .then((data) => {
          if (data.paid) {
            setExportUnlocked(true);
            setMessage("Payment confirmed. Excel and PDF quotation export are unlocked for this session.");
          }
        })
        .catch(() => {
          setMessage("Payment verification could not be completed. Please try again.");
        });
    } else if (params.get("checkout") === "cancelled") {
      setMessage("Checkout cancelled. You can continue reviewing your quotation and pay when ready to export.");
    }
  }, []);

  async function startCheckout() {
    if (!readyLines.length) {
      setMessage("Resolve at least one quotation line before checkout.");
      return;
    }

    setCheckoutBusy(true);
    try {
      const response = await fetch("/api/checkout", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.url) {
        setMessage(data.error || "Unable to start checkout right now.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setMessage("Unable to start checkout right now.");
    } finally {
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

      setCatalogue(parsed);
      setManualMatches({});
      setCatalogueName(file.name);
      setMessage(
        `Loaded ${parsed.length} catalogue item${parsed.length === 1 ? "." : "s."} Matching has been recalculated.`
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
    if (!exportUnlocked) {
      setMessage("Pay once to unlock Excel and PDF export for this quotation session.");
      return;
    }
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

  function printQuotation() {
    if (!exportUnlocked) {
      setMessage("Pay once to unlock Excel and PDF export for this quotation session.");
      return;
    }
    if (!readyLines.length) {
      setMessage("No approved quotation lines are ready to print.");
      return;
    }

    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) {
      setMessage("Pop-up was blocked. Allow pop-ups to print or save the quotation as PDF.");
      return;
    }

    const rows = readyLines
      .map(
        (line, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(line.matchedCode ?? line.code)}</td>
            <td>${escapeHtml(line.matchedDescription ?? line.description)}</td>
            <td class="num">${line.quantity}</td>
            <td>${escapeHtml(line.unit)}</td>
            <td class="num">${meta.currency} ${(line.approvedUnitPrice ?? 0).toFixed(2)}</td>
            <td class="num">${meta.currency} ${(line.lineTotal ?? 0).toFixed(2)}</td>
          </tr>
        `
      )
      .join("");

    win.document.write(`
      <!doctype html>
      <html>
      <head>
        <title>${escapeHtml(meta.quoteNumber)} - Quotation</title>
        <style>
          body{font-family:Arial,sans-serif;margin:44px;color:#15171a}
          .top{display:flex;justify-content:space-between;gap:24px;margin-bottom:36px}
          h1{font-size:30px;margin:0 0 8px}.muted{color:#68707a}
          .meta{line-height:1.7;text-align:right}
          table{width:100%;border-collapse:collapse;margin-top:24px}
          th,td{border-bottom:1px solid #ddd;padding:10px 8px;text-align:left;font-size:12px}
          th{background:#f4f5f7;text-transform:uppercase;font-size:10px;letter-spacing:.06em}
          .num{text-align:right}.total{margin-top:24px;text-align:right;font-size:18px;font-weight:700}
          .notes{margin-top:32px;padding-top:18px;border-top:1px solid #ddd;white-space:pre-wrap}
          .foot{margin-top:42px;font-size:10px;color:#7a818a}
          @media print{body{margin:20mm}.no-print{display:none}}
        </style>
      </head>
      <body>
        <div class="top">
          <div>
            <h1>QUOTATION</h1>
            <strong>${escapeHtml(meta.supplierName)}</strong>
            <div class="muted">Prepared from ${escapeHtml(sourceName)}</div>
          </div>
          <div class="meta">
            <div><strong>Quote:</strong> ${escapeHtml(meta.quoteNumber)}</div>
            <div><strong>Customer:</strong> ${escapeHtml(meta.customerName)}</div>
            <div><strong>Valid:</strong> ${escapeHtml(meta.validDays)} days</div>
          </div>
        </div>
        <table>
          <thead><tr><th>#</th><th>Code</th><th>Description</th><th>Qty</th><th>Unit</th><th>Unit price</th><th>Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="total">Approved subtotal: ${escapeHtml(meta.currency)} ${quote.subtotal.toFixed(2)}</div>
        ${meta.notes ? `<div class="notes"><strong>Notes</strong><br/>${escapeHtml(meta.notes)}</div>` : ""}
        <div class="foot">Generated by QuoteFlow. Only reviewer-approved lines with approved catalogue prices are included.</div>
        <script>window.onload=()=>window.print();</script>
      </body></html>
    `);
    win.document.close();
    setMessage("Quotation opened for printing. Choose “Save as PDF” in the print dialog for a PDF copy.");
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

      <div className="export-row">
        <div>
          <strong>{exportUnlocked ? "Quotation export unlocked" : "Export this quotation · US$29"}</strong>
          <span>
            {exportUnlocked
              ? "Only Ready lines are included. Review and Blocked lines remain excluded."
              : "Review your quotation first. Pay once only when you are ready to export Excel or PDF."}
          </span>
        </div>
        <div className="export-actions">
          {exportUnlocked ? (
            <>
              <button type="button" className="secondary-button" onClick={downloadQuoteExcel}>Download Excel</button>
              <button type="button" onClick={printQuotation}>Print / Save PDF</button>
            </>
          ) : (
            <button type="button" onClick={startCheckout} disabled={checkoutBusy || !readyLines.length}>
              {checkoutBusy ? "Opening checkout..." : "Pay US$29 & unlock export"}
            </button>
          )}
        </div>
      </div>

      <div className="guardrail">
        <strong>QuoteFlow safety rule</strong>
        <span>PDF extraction must be reviewed. Missing prices and uncertain matches never enter the quotation until a reviewer resolves them.</span>
      </div>
    </section>
  );
}
