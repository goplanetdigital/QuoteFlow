"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { buildQuote, demoRfq, parseCsv, RfqLine } from "../../lib/quoteflow";

export default function QuoteWorkspace() {
  const [rfqLines, setRfqLines] = useState<RfqLine[]>(demoRfq);
  const [sourceName, setSourceName] = useState("Synthetic RFQ demo.csv");
  const [message, setMessage] = useState("Demo data loaded. Upload a CSV to replace it.");

  const quote = useMemo(() => buildQuote(rfqLines), [rfqLines]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setMessage("MVP-01 currently accepts CSV for live parsing. PDF/XLSX extraction comes next.");
      return;
    }

    const text = await file.text();
    const parsed = parseCsv(text);

    if (!parsed.length) {
      setMessage("Could not detect usable rows. Expected columns: code, description, quantity, unit.");
      return;
    }

    setRfqLines(parsed);
    setSourceName(file.name);
    setMessage("Loaded " + parsed.length + " RFQ line" + (parsed.length === 1 ? "." : "s."));
  }

  function resetDemo() {
    setRfqLines(demoRfq);
    setSourceName("Synthetic RFQ demo.csv");
    setMessage("Synthetic demo restored.");
  }

  return (
    <section id="workspace" className="workspace">
      <div className="workspace-head">
        <div>
          <div className="eyebrow">MVP-01 · review workspace</div>
          <h2>RFQ to quotation</h2>
          <p className="muted">{sourceName}</p>
        </div>

        <div className="workspace-actions">
          <button className="secondary-button" type="button" onClick={resetDemo}>
            Reset demo
          </button>
          <label className="upload-button">
            Upload CSV
            <input type="file" accept=".csv,text/csv" onChange={handleUpload} />
          </label>
        </div>
      </div>

      <div className="notice">{message}</div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source item</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Catalogue match</th>
              <th>Approved price</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((row) => (
              <tr key={row.id}>
                <td>{row.code || "—"}</td>
                <td>
                  <strong>{row.description}</strong>
                  {row.matchedDescription && row.matchedDescription !== row.description ? (
                    <small>Matched: {row.matchedDescription}</small>
                  ) : null}
                </td>
                <td>{row.quantity} {row.unit}</td>
                <td>
                  <span className={"match " + row.matchStatus}>{row.matchStatus}</span>
                  {row.matchedCode ? <small>{row.matchedCode}</small> : null}
                </td>
                <td>
                  {row.approvedUnitPrice === null
                    ? "No approved price"
                    : "$" + row.approvedUnitPrice.toFixed(2)}
                </td>
                <td>{row.lineTotal === null ? "—" : "$" + row.lineTotal.toFixed(2)}</td>
                <td>
                  <span className={"status " + row.reviewStatus}>{row.reviewStatus}</span>
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
        <div className="subtotal"><span>Approved subtotal</span><strong>{quote.subtotal.toFixed(2)}</strong></div>
      </div>

      <div className="guardrail">
        <strong>QuoteFlow safety rule</strong>
        <span>Blocked or uncertain rows are never silently converted into approved quotation lines.</span>
      </div>
    </section>
  );
}
