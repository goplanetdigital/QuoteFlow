export type MatchState = "exact" | "possible" | "unmatched";
export type LineStatus = "ready" | "review" | "blocked";

export type QuoteLine = {
  id: string;
  sourceCode: string;
  sourceDescription: string;
  quantity: number;
  unit: string;
  matchedCode: string | null;
  matchedDescription: string | null;
  matchState: MatchState;
  approvedUnitPrice: number | null;
  currency: "USD";
  status: LineStatus;
  note?: string;
};

export const demoLines: QuoteLine[] = [
  {
    id: "1",
    sourceCode: "CBL-2C-1.5",
    sourceDescription: "2 Core Cable 1.5mm",
    quantity: 120,
    unit: "m",
    matchedCode: "CBL-2C-1.5",
    matchedDescription: "2 Core Cable 1.5mm",
    matchState: "exact",
    approvedUnitPrice: 0.82,
    currency: "USD",
    status: "ready"
  },
  {
    id: "2",
    sourceCode: "SW-20A",
    sourceDescription: "20A Double Pole Switch",
    quantity: 12,
    unit: "pcs",
    matchedCode: "SW-DP-20A",
    matchedDescription: "20A DP Switch",
    matchState: "possible",
    approvedUnitPrice: 6.4,
    currency: "USD",
    status: "review",
    note: "Catalogue description is similar but not identical."
  },
  {
    id: "3",
    sourceCode: "DB-12W",
    sourceDescription: "12 Way Distribution Board",
    quantity: 3,
    unit: "pcs",
    matchedCode: "DB-12WAY",
    matchedDescription: "12 Way Distribution Board",
    matchState: "exact",
    approvedUnitPrice: null,
    currency: "USD",
    status: "blocked",
    note: "Matched item has no approved price."
  }
];

export function lineTotal(line: QuoteLine) {
  if (line.status !== "ready" || line.approvedUnitPrice == null) return 0;
  return line.quantity * line.approvedUnitPrice;
}

export function quoteSubtotal(lines: QuoteLine[]) {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

export function canExportQuote(lines: QuoteLine[]) {
  return lines.length > 0 && lines.some((line) => line.status === "ready");
}
