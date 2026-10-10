import { spreadsheetCsv } from "./spreadsheet";
import {
  buildQuote,
  parseCatalogueCsv,
  parseCsv,
  parsePdfText,
  CatalogueItem,
  RfqLine,
  QuoteLine,
} from "../quoteflow";
import { AppError } from "./config";
export type QuoteMeta = {
  supplierName: string;
  customerName: string;
  quoteNumber: string;
  currency: string;
  validDays: string;
  notes: string;
};
export type Snapshot = {
  lines: QuoteLine[];
  subtotal: number;
  meta: QuoteMeta;
  sourceName: string;
  excludedCount: number;
};
export const MAX_UPLOAD = 1500 * 1024; // Bounded multipart body stays below hosted function request limits.
export const MAX_BODY = 2 * MAX_UPLOAD + 100000;
export function approveQuote(
  rfq: RfqLine[],
  catalogue: CatalogueItem[],
  matches: Record<string, string>,
  meta: QuoteMeta,
  sourceName: string,
): Snapshot {
  if (
    !rfq.length ||
    rfq.length > 500 ||
    !catalogue.length ||
    catalogue.length > 5000
  )
    throw new AppError(422, "Use 1–500 RFQ lines and 1–5,000 catalogue items.");
  const codes = new Set<string>();
  for (const item of catalogue) {
    if (
      !item.description.trim() ||
      item.description.length > 2000 ||
      item.code.length > 200 ||
      !item.unit ||
      item.unit.length > 40
    )
      throw new AppError(422, "Check catalogue descriptions, codes and units.");
    if (
      !item.code.replace(/[^a-z0-9]/gi, "") ||
      codes.has(
        item.code
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim(),
      )
    )
      throw new AppError(
        422,
        "Each catalogue item needs a unique code before payment.",
      );
    codes.add(
      item.code
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim(),
    );
    if (
      item.approvedUnitPrice !== null &&
      (!Number.isFinite(item.approvedUnitPrice) ||
        item.approvedUnitPrice < 0 ||
        item.approvedUnitPrice > 10000000)
    )
      throw new AppError(
        422,
        "Catalogue prices must be finite and non-negative.",
      );
  }
  for (const line of rfq) {
    if (
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      line.quantity > 1000000 ||
      !line.description.trim() ||
      line.description.length > 2000 ||
      line.code.length > 200 ||
      !line.unit ||
      line.unit.length > 40
    )
      throw new AppError(422, "RFQ quantities and descriptions need review.");
  }
  const lines = buildQuote(rfq, catalogue).lines.map((line) => {
    const code = matches[line.id];
    const selected = code
      ? catalogue.find((item) => item.code === code)
      : undefined;
    if (code && !selected)
      throw new AppError(
        422,
        "An approved match is no longer in the catalogue.",
      );
    if (selected)
      line = {
        ...line,
        matchedCode: selected.code,
        matchedDescription: selected.description,
        approvedUnitPrice: selected.approvedUnitPrice,
        reviewStatus: selected.approvedUnitPrice === null ? "blocked" : "ready",
        lineTotal:
          selected.approvedUnitPrice === null
            ? null
            : Number((selected.approvedUnitPrice * line.quantity).toFixed(2)),
      };
    const item = catalogue.find((item) => item.code === line.matchedCode);
    if (selected && item && item.unit.toLowerCase() !== line.unit.toLowerCase())
      throw new AppError(
        422,
        "RFQ and catalogue units differ. Correct the source files before payment.",
      );
    return line;
  });
  const ready = lines.filter((line) => line.reviewStatus === "ready");
  if (!ready.length)
    throw new AppError(422, "Resolve at least one line before payment.");
  return {
    lines,
    subtotal: Number(
      ready.reduce((n, line) => n + (line.lineTotal ?? 0), 0).toFixed(2),
    ),
    meta,
    sourceName,
    excludedCount: lines.length - ready.length,
  };
}
function readObject(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    /* invalid JSON */
  }
  throw new AppError(400, "Invalid quotation details.");
}
export function readMeta(text: string): QuoteMeta {
  const raw = readObject(text);
  const result: Record<string, string> = {};
  for (const field of [
    "supplierName",
    "customerName",
    "quoteNumber",
    "currency",
    "validDays",
    "notes",
  ]) {
    if (
      typeof raw[field] !== "string" ||
      (raw[field] as string).length > (field === "notes" ? 2000 : 200)
    )
      throw new AppError(400, "Quotation details are missing or too long.");
    result[field] = (raw[field] as string).trim();
  }
  if (
    !/^[A-Z]{3}$/.test(result.currency) ||
    !/^\d{1,3}$/.test(result.validDays) ||
    Number(result.validDays) < 1
  )
    throw new AppError(
      400,
      "Check the quotation currency and validity period.",
    );
  if (!result.supplierName || !result.customerName || !result.quoteNumber)
    throw new AppError(
      400,
      "Supplier, customer and quote number are required.",
    );
  return result as QuoteMeta;
}
export function readMatches(text: string) {
  const raw = readObject(text);
  if (
    Object.keys(raw).length > 500 ||
    Object.values(raw).some((v) => typeof v !== "string" || v.length > 200)
  )
    throw new AppError(400, "Invalid match approvals.");
  return raw as Record<string, string>;
}
export async function parseUpload(file: File, kind: "rfq" | "catalogue") {
  if (!file.size || file.size > MAX_UPLOAD)
    throw new AppError(400, "Each file must be smaller than 1.5 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = file.name.toLowerCase().split(".").pop();
  let csv: string;
  if (ext === "pdf" && kind === "rfq") {
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      throw new AppError(400, "Invalid PDF file.");
    const parser = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const result = await parser(bytes);
    return { bytes, rows: parsePdfText(result.text).lines };
  }
  if (ext === "csv") csv = bytes.toString("utf8");
  else if (ext === "xlsx") csv = await spreadsheetCsv(bytes, kind === "rfq" ? 501 : 5001);
  else if (ext === "xls") throw new AppError(400, "Legacy XLS is unsupported. Save it as a values-only XLSX or CSV first.");
  else throw new AppError(400, "Use CSV or values-only XLSX, or a selectable-text RFQ PDF.");
  return {
    bytes,
    rows: kind === "rfq" ? parseCsv(csv) : parseCatalogueCsv(csv),
  };
}
