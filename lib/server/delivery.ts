import writeXlsxFile from "write-excel-file/node";
import { Snapshot } from "./input";
function html(v: string) {
  return v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
function cell(v: string) {
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
export async function generateDelivery(s: Snapshot) {
  const ready = s.lines.filter((line) => line.reviewStatus === "ready");
  const m = s.meta;
  const sheet = [
    ["QUOTATION"],
    ["Supplier", cell(m.supplierName)],
    ["Customer", cell(m.customerName)],
    ["Quote", cell(m.quoteNumber)],
    ["Currency", m.currency],
    ["Validity days", m.validDays],
    ["Source", cell(s.sourceName)],
    [
      "Code",
      "Description",
      "Quantity",
      "Unit",
      "Catalogue unit price",
      "Total",
    ],
    ...ready.map((l) => [
      cell(l.matchedCode ?? ""),
      cell(l.matchedDescription ?? l.description),
      l.quantity,
      cell(l.unit),
      l.approvedUnitPrice,
      l.lineTotal,
    ]),
    ["Approved subtotal", s.subtotal],
    ["Excluded lines needing review", s.excludedCount],
    ["Notes", cell(m.notes)],
  ];
  const audit = [
    ["SourceCode", "SourceDescription", "Quantity", "Unit", "Match", "Status", "SelectedCode", "CataloguePrice"],
    ...s.lines.map((l) => [
      cell(l.code), cell(l.description), l.quantity, cell(l.unit),
      l.matchStatus, l.reviewStatus, cell(l.matchedCode ?? ""), l.approvedUnitPrice,
    ]),
  ];
  const excel = await writeXlsxFile([
    { sheet: "Quotation", data: sheet },
    { sheet: "Review audit", data: audit },
  ]).toBuffer();
  const printable = Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>${html(m.quoteNumber)}</title><style>body{font-family:Arial;margin:40px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left}.notes{white-space:pre-wrap}</style></head><body><h1>Quotation ${html(m.quoteNumber)}</h1><p>Supplier: ${html(m.supplierName)} · Customer: ${html(m.customerName)}</p><p>Currency: ${html(m.currency)} · Valid: ${html(m.validDays)} days</p><table><thead><tr><th>Code</th><th>Description</th><th>Qty</th><th>Unit</th><th>Price</th><th>Total</th></tr></thead><tbody>${ready.map((l) => `<tr><td>${html(l.matchedCode ?? "")}</td><td>${html(l.matchedDescription ?? l.description)}</td><td>${l.quantity}</td><td>${html(l.unit)}</td><td>${l.approvedUnitPrice?.toFixed(2)}</td><td>${l.lineTotal?.toFixed(2)}</td></tr>`).join("")}</tbody></table><h2>Approved subtotal: ${html(m.currency)} ${s.subtotal.toFixed(2)}</h2><p>${s.excludedCount} unapproved or unpriced lines excluded. Source: ${html(s.sourceName)}</p><p class="notes">${html(m.notes)}</p><p>Use your browser’s Print → Save as PDF for a PDF copy.</p></body></html>`,
  );
  return { excel, printable };
}
