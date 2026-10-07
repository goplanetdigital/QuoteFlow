export type RfqLine = {
  id: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
};

export type CatalogueItem = {
  code: string;
  description: string;
  unit: string;
  approvedUnitPrice: number | null;
};

export type MatchStatus = "exact" | "possible" | "unmatched";
export type ReviewStatus = "ready" | "review" | "blocked";

export type QuoteLine = RfqLine & {
  matchedCode: string | null;
  matchedDescription: string | null;
  matchStatus: MatchStatus;
  reviewStatus: ReviewStatus;
  approvedUnitPrice: number | null;
  lineTotal: number | null;
};

export const demoCatalogue: CatalogueItem[] = [
  { code: "CBL-2C-1.5", description: "2 Core Cable 1.5mm", unit: "m", approvedUnitPrice: 0.82 },
  { code: "SW-20A", description: "20A Double Pole Switch", unit: "pcs", approvedUnitPrice: 12.4 },
  { code: "DB-12W", description: "12 Way Distribution Board", unit: "pcs", approvedUnitPrice: null },
  { code: "MCB-32A", description: "32A Miniature Circuit Breaker", unit: "pcs", approvedUnitPrice: 8.9 }
];

export const demoRfq: RfqLine[] = [
  { id: "1", code: "CBL-2C-1.5", description: "2 Core Cable 1.5mm", quantity: 120, unit: "m" },
  { id: "2", code: "SW20", description: "20 amp double pole wall switch", quantity: 12, unit: "pcs" },
  { id: "3", code: "DB-12W", description: "Distribution board 12 way", quantity: 3, unit: "pcs" }
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function words(value: string) {
  return new Set(normalize(value).split(" ").filter(Boolean));
}

function overlapScore(a: string, b: string) {
  const aw = words(a);
  const bw = words(b);
  if (!aw.size || !bw.size) return 0;
  let shared = 0;
  aw.forEach((word) => {
    if (bw.has(word)) shared += 1;
  });
  return shared / Math.max(aw.size, bw.size);
}

export function matchLine(line: RfqLine, catalogue = demoCatalogue): QuoteLine {
  const exact = catalogue.find((item) => normalize(item.code) === normalize(line.code));
  const scored = catalogue
    .map((item) => ({
      item,
      score: Math.max(
        overlapScore(line.description, item.description),
        overlapScore(line.code, item.code)
      )
    }))
    .sort((a, b) => b.score - a.score);

  const candidate = exact ?? scored[0]?.item;
  const candidateScore = candidate
    ? Math.max(
        overlapScore(line.description, candidate.description),
        overlapScore(line.code, candidate.code)
      )
    : 0;

  const matchStatus: MatchStatus = exact
    ? "exact"
    : candidate && candidateScore >= 0.35
      ? "possible"
      : "unmatched";

  const matched = matchStatus === "unmatched" ? null : candidate ?? null;
  const price = matched?.approvedUnitPrice ?? null;

  const reviewStatus: ReviewStatus =
    matchStatus === "unmatched" || price === null
      ? "blocked"
      : matchStatus === "possible"
        ? "review"
        : "ready";

  return {
    ...line,
    matchedCode: matched?.code ?? null,
    matchedDescription: matched?.description ?? null,
    matchStatus,
    reviewStatus,
    approvedUnitPrice: price,
    lineTotal: price === null ? null : Number((price * line.quantity).toFixed(2))
  };
}

export function buildQuote(lines: RfqLine[]) {
  const quoteLines = lines.map((line) => matchLine(line));
  const subtotal = quoteLines.reduce((sum, line) => sum + (line.reviewStatus === "ready" ? line.lineTotal ?? 0 : 0), 0);

  return {
    lines: quoteLines,
    subtotal: Number(subtotal.toFixed(2)),
    readyCount: quoteLines.filter((line) => line.reviewStatus === "ready").length,
    reviewCount: quoteLines.filter((line) => line.reviewStatus === "review").length,
    blockedCount: quoteLines.filter((line) => line.reviewStatus === "blocked").length
  };
}

export function parseCsv(text: string): RfqLine[] {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length < 2) return [];

  const headers = rows[0].split(",").map((header) => normalize(header));
  const codeIndex = headers.findIndex((h) => ["code", "sku", "item code", "product code"].includes(h));
  const descIndex = headers.findIndex((h) => ["description", "item", "product"].includes(h));
  const qtyIndex = headers.findIndex((h) => ["qty", "quantity"].includes(h));
  const unitIndex = headers.findIndex((h) => ["unit", "uom"].includes(h));

  if (descIndex < 0 || qtyIndex < 0) return [];

  return rows.slice(1).map((row, index) => {
    const cols = row.split(",").map((col) => col.trim());

    return {
      id: String(index + 1),
      code: codeIndex >= 0 ? cols[codeIndex] ?? "" : "",
      description: cols[descIndex] ?? "",
      quantity: Number(cols[qtyIndex] ?? 0) || 0,
      unit: unitIndex >= 0 ? cols[unitIndex] ?? "pcs" : "pcs"
    };
  }).filter((line) => line.description && line.quantity > 0);
}
