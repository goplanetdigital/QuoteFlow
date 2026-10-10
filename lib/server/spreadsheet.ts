import yauzl from "yauzl";
import sax from "sax";
import { zipSync } from "fflate";
import { readSheet } from "read-excel-file/node";
import { AppError } from "./config";

export const MAX_EXPANDED = 16 * 1024 * 1024;
const MAX_ENTRY = 8 * 1024 * 1024;
const unsafe = () => new AppError(422, "Invalid or unsafe spreadsheet. Use a values-only XLSX or CSV without formulas, macros or external links.");

// Validate actual inflated bytes, not just ZIP metadata. Never extract files to disk.
async function validatedEntries(bytes: Buffer, maxRows: number) {
  const archive = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => error ? reject(error) : resolve(zip!));
  });
  const files: Record<string, Uint8Array> = Object.create(null);
  let total = 0, entries = 0, cells = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      archive.on("error", reject);
      archive.on("end", resolve);
      archive.on("entry", (entry: yauzl.Entry) => {
        void (async () => {
          const name = entry.fileName;
          if (++entries > 100 || name.length > 200 || name.startsWith("/") || name.split("/").some(p => p === ".." || p === ".") || Object.hasOwn(files, name) || (entry.generalPurposeBitFlag & 1)) throw unsafe();
          if (name.endsWith("/")) { archive.readEntry(); return; }
          if (!/\.(xml|rels)$/.test(name) || /externalLinks|embeddings|vba|activeX/i.test(name) || entry.uncompressedSize > MAX_ENTRY || total + entry.uncompressedSize > MAX_EXPANDED) throw unsafe();
          const stream = await new Promise<import("node:stream").Readable>((res, rej) => archive.openReadStream(entry, (err, s) => err ? rej(err) : res(s!)));
          let size = 0;
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            size += chunk.length; total += chunk.length;
            if (size > MAX_ENTRY || total > MAX_EXPANDED) { stream.destroy(); throw unsafe(); }
            chunks.push(chunk);
          }
          const content = Buffer.concat(chunks);
          // UTF-8 only, with fatal decoding; DTDs/entities and deep XML are forbidden.
          const xml = new TextDecoder("utf-8", { fatal: true }).decode(content);
          let depth = 0, roots = 0, rows = 0, nodes = 0;
          const parser = sax.parser(true, { xmlns: true });
          parser.ondoctype = () => { throw unsafe(); };
          parser.onopentag = rawTag => {
            const tag = rawTag as sax.QualifiedTag;
            if ((depth === 0 && ++roots > 1) || ++depth > 32 || ++nodes > 350000 || tag.local === "f") throw unsafe();
            const attrs = Object.fromEntries(Object.values(tag.attributes).map(a => [typeof a === "string" ? a : a.local, typeof a === "string" ? a : a.value]));
            if (attrs.TargetMode?.toLowerCase() === "external" || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(attrs.Target ?? "") || /macroEnabled|vbaProject|oleObject/i.test(attrs.ContentType ?? "")) throw unsafe();
            if (tag.local === "row" && (++rows > maxRows || !/^\d+$/.test(attrs.r ?? "") || Number(attrs.r) < 1 || Number(attrs.r) > maxRows)) throw unsafe();
            if (tag.local === "c") {
              if (++cells > 160032) throw unsafe();
              const ref = /^([A-Z]{1,2})([1-9]\d*)$/.exec(attrs.r ?? "");
              const col = ref?.[1].split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
              if (!ref || !col || col > 32 || Number(ref[2]) > maxRows) throw unsafe();
            }
          };
          parser.onclosetag = () => { depth--; };
          parser.write(xml).close();
          if (roots !== 1) throw unsafe();
          files[name] = content;
          archive.readEntry();
        })().catch(error => { archive.close(); reject(error); });
      });
      archive.readEntry();
    });
    if (!files["[Content_Types].xml"] || !files["xl/workbook.xml"]) throw unsafe();
    return files;
  } finally { archive.close(); }
}

export async function spreadsheetCsv(bytes: Buffer, maxRows: number) {
  try {
    const entries = await validatedEntries(bytes, maxRows);
    // Rebuild from checked entries so a second ZIP parser cannot interpret conflicting
    // local/central headers or unvalidated entries differently.
    const safeZip = Buffer.from(zipSync(entries, { level: 0 }));
    const rows = await readSheet(safeZip, { trim: false });
    if (!rows.length || rows.length > maxRows || rows.some(row => row.length > 32 || row.some(v => v instanceof Date || typeof v === "boolean"))) throw unsafe();
    return rows.map(row => row.map(v => '"' + String(v ?? "").replaceAll('"', '""') + '"').join(",")).join("\n");
  } catch { throw unsafe(); }
}
