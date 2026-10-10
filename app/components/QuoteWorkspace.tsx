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

async function fileToCsv(file: File, kind: "rfq" | "catalogue") {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const response = await fetch("/api/extract-spreadsheet", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not read this spreadsheet.");
  return String(data.csv);
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
  const [rfqFile, setRfqFile] = useState<File | null>(null);
  const [catalogueFile, setCatalogueFile] = useState<File | null>(null);
  const [pricesApproved, setPricesApproved] = useState(false);
  const [fee, setFee] = useState<string | null>(null);
  const [pendingJob, setPendingJob] = useState<string | null>(null);
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
        reviewStatus: price === null || !Number.isFinite(price) || selected.unit.toLowerCase() !== line.unit.toLowerCase() ? ("blocked" as const) : ("ready" as const)
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
    fetch("/api/checkout").then(async response => {
      const data = await response.json();
      if (!response.ok) { setMessage(data.error); return; }
      setFee(new Intl.NumberFormat("en", { style: "currency", currency: data.currency }).format(data.amount / 100));
    }).catch(() => setMessage("Payments are unavailable. You can continue reviewing your files."));
  }, []);

  async function startCheckout() {
    if (!readyLines.length || !pricesApproved || !fee) return;
    setCheckoutBusy(true);
    try {
      const csvRow = (values: (string | number | null)[]) => values.map(v => '"' + String(v ?? "").replaceAll('"', '""') + '"').join(",");
      const rfqCsv = ["code,description,quantity,unit", ...rfqLines.map(l => csvRow([l.code,l.description,l.quantity,l.unit]))].join("\n");
      const catalogueCsv = ["code,description,unit,price", ...catalogue.map(l => csvRow([l.code,l.description,l.unit,l.approvedUnitPrice]))].join("\n");
      const form = new FormData();
      form.append("rfq", rfqFile ?? new File([rfqCsv], "synthetic-rfq.csv", { type: "text/csv" }));
      form.append("catalogue", catalogueFile ?? new File([catalogueCsv], "synthetic-catalogue.csv", { type: "text/csv" }));
      form.append("matches", JSON.stringify(manualMatches)); form.append("meta", JSON.stringify(meta)); form.append("approved", "true");
      const response = await fetch("/api/jobs", { method: "POST", body: form });
      const job = await response.json();
      if (!response.ok) { setMessage(job.error || "Unable to save your quotation."); return; }
      setPendingJob(job.id);
      // Show the frozen server quotation before opening the payment provider.
      window.location.href = `/jobs/${job.id}`;
    } catch { setMessage("Unable to save the quotation. Please retry."); }
    finally { setCheckoutBusy(false); }
  }

  async function handleRfqUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setManualMatches({});
    setPricesApproved(false);
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

        setRfqFile(file);
        setRfqLines(parsed.lines);
        setSourceName(file.name);
        setMessage(
          `Extracted ${parsed.lines.length} candidate RFQ lines from ${data.pages ?? "the"} PDF page(s). Review all lines before export.`
        );
        return;
      }

      const csv = await fileToCsv(file, "rfq");
      if (!csv) {
        setMessage("Unsupported RFQ file. Use PDF, CSV, values-only XLSX.");
        return;
      }

      const parsed = parseCsv(csv);
      if (!parsed.length) {
        setMessage(
          "Could not detect RFQ rows. Expected columns such as code, description, quantity, and unit."
        );
        return;
      }

      setRfqFile(file);
      setRfqLines(parsed);
      setSourceName(file.name);
      setMessage(
        `Loaded ${parsed.length} RFQ line${parsed.length === 1 ? "." : "s."}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read that RFQ file. Please check its format.");
    }
  }

  async function handleCatalogueUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const csv = await fileToCsv(file, "catalogue");
      if (!csv) {
        setMessage("Unsupported catalogue file. Use CSV, values-only XLSX.");
        return;
      }

      const parsed = parseCatalogueCsv(csv);
      if (!parsed.length) {
        setMessage(
          "Could not detect catalogue rows. Expected description and price columns; code and unit are optional."
        );
        return;
      }

      setCatalogueFile(file);
      setPricesApproved(false);
      setCatalogue(parsed);
      setManualMatches({});
      setCatalogueName(file.name);
      setMessage(
        `Loaded ${parsed.length} catalogue item${parsed.length === 1 ? "." : "s."} Matching has been recalculated.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read that catalogue file. Please check its spreadsheet format.");
    }
  }

  function updateMeta(field: keyof QuoteMeta, value: string) {
    setPricesApproved(false);
    setMeta((current) => ({ ...current, [field]: value }));
  }

  function approveSuggested(lineId: string, matchedCode: string | null) {
    if (!matchedCode) return;
    setPricesApproved(false);
    setManualMatches((current) => ({ ...current, [lineId]: matchedCode }));
    setMessage("Match approved by reviewer. The line is now eligible for quotation if an approved price exists.");
  }

  function chooseCatalogueItem(lineId: string, code: string) {
    setPricesApproved(false);
    setManualMatches((current) => {
      const next = { ...current };
      if (!code) delete next[lineId];
      else next[lineId] = code;
      return next;
    });
  }

  function resetDemo() {
    setRfqFile(null);
    setCatalogueFile(null);
    setPricesApproved(false);
    setRfqLines(demoRfq);
    setCatalogue(demoCatalogue);
    setManualMatches({});
    setSourceName("Synthetic RFQ demo.csv");
    setCatalogueName("Built-in demo catalogue");
    setMessage("Synthetic RFQ and demo catalogue restored.");
  }

  return (
    <section id="workspace" className="workspace">
      <div className="workspace-head">
        <div>
          <div className="eyebrow">MVP-03 · end-to-end quotation workflow</div>
          <h2>RFQ to quotation</h2>
          <p className="muted">RFQ: {sourceName} · Each file must be smaller than 1.5 MB</p>
          <p className="muted">Catalogue: {catalogueName} · {catalogue.length} items</p>
        </div>

        <div className="workspace-actions">
          <button className="secondary-button" type="button" onClick={resetDemo}>Reset demo</button>
          <label className="upload-button secondary-upload">
            Upload catalogue
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleCatalogueUpload}
            />
          </label>
          <label className="upload-button">
            Upload RFQ
            <input
              type="file"
              accept=".pdf,.csv,.xlsx,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleRfqUpload}
            />
          </label>
        </div>
      </div>

      <div className="notice" role="status">{message}</div>

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
                  {row.reviewStatus === "blocked" && row.approvedUnitPrice !== null ? <small>Check price and catalogue unit</small> : null}
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
          <strong>Export one reviewed quotation</strong>
          <span>The service fee is separate from your quotation subtotal. Only Ready lines are included.</span>
        </div>
        <div className="export-actions">
          <label><input type="checkbox" checked={pricesApproved} onChange={e => setPricesApproved(e.target.checked)} /> I reviewed the source quantities, matches and catalogue prices. I accept that {quote.reviewCount + quote.blockedCount} unresolved lines are excluded.</label>
          <button type="button" onClick={startCheckout} disabled={checkoutBusy || !readyLines.length || !pricesApproved || !fee}>
            {checkoutBusy ? "Saving quotation..." : fee ? `Review saved quotation · ${fee} test payment` : "Test payments unavailable"}
          </button>
          {pendingJob ? <a href={`/jobs/${pendingJob}`}>Resume saved quotation</a> : null}
        </div>
      </div>

      <p><a href="/policies">Support, refunds, privacy and terms</a> · Test payments only</p>
      <div className="guardrail">
        <strong>QuoteFlow safety rule</strong>
        <span>PDF extraction must be reviewed. Missing prices and uncertain matches never enter the quotation until a reviewer resolves them.</span>
      </div>
    </section>
  );
}
