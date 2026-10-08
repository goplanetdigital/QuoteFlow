"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  buildQuote,
  CatalogueItem,
  demoCatalogue,
  demoRfq,
  parseCatalogueCsv,
  parseCsv,
  RfqLine
} from "../../lib/quoteflow";

async function fileToCsv(file: File) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".csv")) {
    return file.text();
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return "";
    }

    const sheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_csv(sheet);
  }

  return "";
}

export default function QuoteWorkspace() {
  const [rfqLines, setRfqLines] = useState<RfqLine[]>(demoRfq);
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>(demoCatalogue);
  const [sourceName, setSourceName] = useState("Synthetic RFQ demo.csv");
  const [catalogueName, setCatalogueName] = useState("Built-in demo catalogue");
  const [message, setMessage] = useState(
    "Demo data loaded. Upload your RFQ and catalogue as CSV or Excel."
  );

  const quote = useMemo(() => buildQuote(rfqLines, catalogue), [rfqLines, catalogue]);

  async function handleRfqUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const csv = await fileToCsv(file);
      if (!csv) {
        setMessage("Unsupported RFQ file. Use CSV, XLSX, or XLS.");
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
        "Loaded " + parsed.length + " RFQ line" + (parsed.length === 1 ? "." : "s.")
      );
    } catch {
      setMessage("Could not read that RFQ file. Please check the spreadsheet format.");
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
      setCatalogueName(file.name);
      setMessage(
        "Loaded " +
          parsed.length +
          " catalogue item" +
          (parsed.length === 1 ? "." : "s.") +
          " RFQ matching has been recalculated."
      );
    } catch {
      setMessage("Could not read that catalogue file. Please check the spreadsheet format.");
    }
  }

  function resetDemo() {
    setRfqLines(demoRfq);
    setCatalogue(demoCatalogue);
    setSourceName("Synthetic RFQ demo.csv");
    setCatalogueName("Built-in demo catalogue");
    setMessage("Synthetic RFQ and demo catalogue restored.");
  }

  function downloadApprovedQuote() {
    const ready = quote.lines.filter((line) => line.reviewStatus === "ready");

    if (!ready.length) {
      setMessage("No approved quotation lines are ready to export.");
      return;
    }

    const header = [
      "source_code",
      "description",
      "quantity",
      "unit",
      "matched_code",
      "unit_price",
      "line_total"
    ];

    const rows = ready.map((line) => [
      line.code,
      line.description,
      line.quantity,
      line.unit,
      line.matchedCode ?? "",
      line.approvedUnitPrice ?? "",
      line.lineTotal ?? ""
    ]);

    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((value) => '"' + String(value).replaceAll('"', '""') + '"')
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "quoteflow-approved-quotation.csv";
    anchor.click();
    URL.revokeObjectURL(url);

    setMessage("Exported approved quotation lines. Review and blocked lines were excluded.");
  }

  return (
    <section id="workspace" className="workspace">
      <div className="workspace-head">
        <div>
          <div className="eyebrow">MVP-02 · real file inputs</div>
          <h2>RFQ to quotation</h2>
          <p className="muted">RFQ: {sourceName}</p>
          <p className="muted">
            Catalogue: {catalogueName} · {catalogue.length} items
          </p>
        </div>

        <div className="workspace-actions">
          <button className="secondary-button" type="button" onClick={resetDemo}>
            Reset demo
          </button>

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
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleRfqUpload}
            />
          </label>
        </div>
      </div>

      <div className="notice">{message}</div>

      <div className="input-status-grid">
        <div>
          <span>RFQ source</span>
          <strong>{rfqLines.length} lines</strong>
          <small>{sourceName}</small>
        </div>
        <div>
          <span>Approved catalogue</span>
          <strong>{catalogue.length} items</strong>
          <small>{catalogueName}</small>
        </div>
      </div>

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
                <td>
                  {row.quantity} {row.unit}
                </td>
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
        <div>
          <strong>{quote.lines.length}</strong>
          <span>RFQ lines</span>
        </div>
        <div>
          <strong>{quote.readyCount}</strong>
          <span>Ready</span>
        </div>
        <div>
          <strong>{quote.reviewCount}</strong>
          <span>Needs review</span>
        </div>
        <div>
          <strong>{quote.blockedCount}</strong>
          <span>Blocked</span>
        </div>
        <div className="subtotal">
          <span>Approved subtotal</span>
          <strong>{"$" + quote.subtotal.toFixed(2)}</strong>
        </div>
      </div>

      <div className="export-row">
        <div>
          <strong>Ready to export</strong>
          <span>
            Only exact, approved-price lines are included. Review and blocked rows stay out.
          </span>
        </div>
        <button type="button" onClick={downloadApprovedQuote}>
          Download approved quote CSV
        </button>
      </div>

      <div className="guardrail">
        <strong>QuoteFlow safety rule</strong>
        <span>
          Customer catalogue prices are treated as approved source data. Missing prices and
          uncertain matches are never silently converted into quotation lines.
        </span>
      </div>
    </section>
  );
}
