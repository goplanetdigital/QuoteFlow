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

export function normalize(value: string) {
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

export function matchLine(line: RfqLine, catalogue: CatalogueItem[] = demoCatalogue): QuoteLine {
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

export function buildQuote(lines: RfqLine[], catalogue: CatalogueItem[] = demoCatalogue) {
  const quoteLines = lines.map((line) => matchLine(line, catalogue));
  const subtotal = quoteLines.reduce(
    (sum, line) => sum + (line.reviewStatus === "ready" ? line.lineTotal ?? 0 : 0),
    0
  );

  return {
    lines: quoteLines,
    subtotal: Number(subtotal.toFixed(2)),
    readyCount: quoteLines.filter((line) => line.reviewStatus === "ready").length,
    reviewCount: quoteLines.filter((line) => line.reviewStatus === "review").length,
    blockedCount: quoteLines.filter((line) => line.reviewStatus === "blocked").length
  };
}

function splitCsvRow(row: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];
    if (char === '"') {
      if (quoted && row[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

export function parseCsv(text: string): RfqLine[] {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length < 2) return [];

  const headers = splitCsvRow(rows[0]).map((header) => normalize(header));
  const codeIndex = headers.findIndex((h) => ["code", "sku", "item code", "product code"].includes(h));
  const descIndex = headers.findIndex((h) => ["description", "item", "product", "item description"].includes(h));
  const qtyIndex = headers.findIndex((h) => ["qty", "quantity"].includes(h));
  const unitIndex = headers.findIndex((h) => ["unit", "uom"].includes(h));

  if (descIndex < 0 || qtyIndex < 0) return [];

  return rows
    .slice(1)
    .map((row, index) => {
      const cols = splitCsvRow(row);
      return {
        id: String(index + 1),
        code: codeIndex >= 0 ? cols[codeIndex] ?? "" : "",
        description: cols[descIndex] ?? "",
        quantity: Number(cols[qtyIndex] ?? 0) || 0,
        unit: unitIndex >= 0 ? cols[unitIndex] ?? "pcs" : "pcs"
      };
    })
    .filter((line) => line.description && line.quantity > 0);
}

export function detectCatalogueCurrency(text: string): string | null {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!rows.length) return null;
  const headers = splitCsvRow(rows[0]).map((h) => normalize(h));
  const currencyIndex = headers.findIndex((h) => ["currency", "currency code", "price currency", "curr"].includes(h));
  const priceIndex = headers.findIndex((h) => ["price", "unit price", "unitprice", "approved price", "approved unit price", "selling price"].includes(h));
  const recognized = new Set(["USD", "MYR", "SGD", "EUR", "GBP", "AUD", "CAD", "JPY", "CNY", "HKD", "INR", "THB", "IDR", "PHP", "AED", "SAR", "NZD", "CHF"]);
  const found = new Set<string>();
  for (const row of rows.slice(1)) {
    const cols = splitCsvRow(row);
    const explicit = currencyIndex >= 0 ? String(cols[currencyIndex] ?? "").trim().toUpperCase() : "";
    if (explicit) {
      if (!recognized.has(explicit)) return null;
      found.add(explicit);
      continue;
    }
    const price = priceIndex >= 0 ? String(cols[priceIndex] ?? "").trim() : "";
    const code = price.match(/\b(USD|MYR|SGD|EUR|GBP|AUD|CAD|JPY|CNY|HKD|INR|THB|IDR|PHP|AED|SAR|NZD|CHF)\b/i);
    if (code) found.add(code[1].toUpperCase());
    else if (/RM\s*\d/i.test(price)) found.add("MYR");
    else if (/S\$\s*\d/i.test(price)) found.add("SGD");
    else if (/€\s*\d/.test(price)) found.add("EUR");
    else if (/£\s*\d/.test(price)) found.add("GBP");
    // A bare $ is ambiguous across USD, SGD, AUD, CAD and other currencies.
  }
  return found.size === 1 ? [...found][0] : null;
}

export function parseCatalogueCsv(text: string): CatalogueItem[] {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length < 2) return [];

  const headers = splitCsvRow(rows[0]).map((header) => normalize(header));
  const codeIndex = headers.findIndex((h) => ["code", "sku", "item code", "product code"].includes(h));
  const descIndex = headers.findIndex((h) => ["description", "item", "product", "item description"].includes(h));
  const unitIndex = headers.findIndex((h) => ["unit", "uom"].includes(h));
  const priceIndex = headers.findIndex((h) =>
    ["price", "unit price", "unitprice", "approved price", "approved unit price", "selling price"].includes(h)
  );

  if (descIndex < 0 || priceIndex < 0) return [];

  return rows
    .slice(1)
    .map((row) => {
      const cols = splitCsvRow(row);
      const rawPrice = String(cols[priceIndex] ?? "").replace(/[^0-9.-]/g, "");
      const parsedPrice = rawPrice ? Number(rawPrice) : NaN;

      return {
        code: codeIndex >= 0 ? cols[codeIndex] ?? "" : "",
        description: cols[descIndex] ?? "",
        unit: unitIndex >= 0 ? cols[unitIndex] ?? "pcs" : "pcs",
        approvedUnitPrice: Number.isFinite(parsedPrice) ? parsedPrice : null
      };
    })
    .filter((item) => item.description);
}


export type PdfParseResult = {
  lines: RfqLine[];
  warnings: string[];
};

function detectUnit(value: string) {
  const v = normalize(value);
  if (["pcs", "pc", "piece", "pieces", "nos", "no", "unit", "units"].includes(v)) return "pcs";
  if (["m", "meter", "metre", "meters", "metres"].includes(v)) return "m";
  if (["ft", "feet"].includes(v)) return "ft";
  if (["kg", "kgs"].includes(v)) return "kg";
  if (["set", "sets"].includes(v)) return "set";
  if (["box", "boxes"].includes(v)) return "box";
  if (["roll", "rolls"].includes(v)) return "roll";
  return "";
}

function looksLikeCode(value: string) {
  const compact = value.trim();
  return /^[A-Z0-9][A-Z0-9._\/-]{2,}$/i.test(compact) && /[A-Za-z]/.test(compact);
}

export function parsePdfText(text: string): PdfParseResult {
  const warnings: string[] = [];
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const parsed: RfqLine[] = [];

  for (const raw of rawLines) {
    if (/^(rfq|request for quotation|quotation|description|item|qty|quantity|unit|uom|price|amount)\b/i.test(raw)) {
      continue;
    }

    const tokens = raw.split(" ");
    if (tokens.length < 2) continue;

    let qtyIndex = -1;
    let quantity = 0;

    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const cleaned = tokens[i].replace(/,/g, "");
      if (/^\d+(?:\.\d+)?$/.test(cleaned)) {
        const num = Number(cleaned);
        if (Number.isFinite(num) && num > 0) {
          qtyIndex = i;
          quantity = num;
          break;
        }
      }
    }

    if (qtyIndex < 0) continue;

    let unit = "pcs";
    let unitIndex = -1;
    for (let i = Math.max(0, qtyIndex - 2); i <= Math.min(tokens.length - 1, qtyIndex + 2); i += 1) {
      const detected = detectUnit(tokens[i]);
      if (detected) {
        unit = detected;
        unitIndex = i;
        break;
      }
    }

    const leading = tokens.slice(0, qtyIndex).filter((_, idx) => idx !== unitIndex);
    const trailing = tokens.slice(qtyIndex + 1).filter((_, idx) => qtyIndex + 1 + idx !== unitIndex);
    const contentTokens = [...leading, ...trailing];

    if (!contentTokens.length) continue;

    const first = contentTokens[0];
    const code = looksLikeCode(first) ? first : "";
    const description = (code ? contentTokens.slice(1) : contentTokens).join(" ").trim();

    if (!description || description.length < 3) continue;

    parsed.push({
      id: String(parsed.length + 1),
      code,
      description,
      quantity,
      unit
    });
  }

  if (!parsed.length) {
    warnings.push(
      "No reliable line items were detected automatically. The PDF may use a complex layout or be a scanned image."
    );
  } else {
    warnings.push(
      "PDF extraction is heuristic. Review every extracted line before generating a quotation."
    );
  }

  return { lines: parsed, warnings };
}
