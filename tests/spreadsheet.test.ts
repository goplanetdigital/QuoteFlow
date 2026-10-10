import { test } from "node:test";
import assert from "node:assert/strict";
import writeXlsxFile from "write-excel-file/node";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { parseUpload, approveQuote } from "../lib/server/input";
import { AppError } from "../lib/server/config";
import { MAX_EXPANDED, spreadsheetCsv } from "../lib/server/spreadsheet";
import { CatalogueItem, RfqLine } from "../lib/quoteflow";

async function fixture() {
  return writeXlsxFile([
    ["code", "description", "quantity", "unit"],
    ["001", "Cable, detail\nsecond line", 2, "m"],
    ["UNMATCHED", "Unknown part", 3, "pcs"],
  ]).toBuffer();
}
async function mutate(change: (files: Record<string, Uint8Array>) => void) {
  const files = unzipSync(await fixture()); change(files);
  return Buffer.from(zipSync(files));
}
function sheet(files: Record<string, Uint8Array>, transform: (xml: string) => string) {
  const key = Object.keys(files).find(k => /^xl\/worksheets\/sheet.*\.xml$/.test(k))!;
  files[key] = strToU8(transform(strFromU8(files[key])));
}
async function rejected(bytes: Buffer) {
  await assert.rejects(parseUpload(new File([new Uint8Array(bytes)], "attack.xlsx"), "rfq"), error => error instanceof AppError && error.status === 422 && /unsafe spreadsheet/.test(error.message));
}
test("values-only XLSX preserves source text, text codes, quantities and approved catalogue prices", async () => {
  const rfq = await parseUpload(new File([new Uint8Array(await fixture())], "rfq.xlsx"), "rfq");
  const bytes = await writeXlsxFile([
    ["code", "description", "unit", "price"],
    ["001", "Catalogue cable", "m", 12.4],
    ["UNMATCHED", "Unknown part", "pcs", null],
  ]).toBuffer();
  const catalogue = await parseUpload(new File([new Uint8Array(bytes)], "catalogue.xlsx"), "catalogue");
  assert.equal((rfq.rows as RfqLine[])[0].code, "001");
  assert.equal((rfq.rows as RfqLine[])[0].description, "Cable, detail\nsecond line");
  const quote = approveQuote(rfq.rows as RfqLine[], catalogue.rows as CatalogueItem[], {}, { supplierName: "Supplier", customerName: "Customer", quoteNumber: "Q1", currency: "USD", validDays: "30", notes: "" }, "rfq.xlsx");
  assert.equal(quote.subtotal, 24.8);
  assert.equal(quote.excludedCount, 1);
  assert.equal(quote.lines[1].approvedUnitPrice, null);
});
test("forged extensions, truncated archives and malformed XML fail as controlled upload errors", async () => {
  await rejected(Buffer.from("not an Excel workbook"));
  await rejected((await fixture()).subarray(0, 100));
  await rejected(await mutate(files => sheet(files, xml => xml.replace("</worksheet>", "</broken>"))));
  await assert.rejects(parseUpload(new File([new Uint8Array(await fixture())], "legacy.xls"), "rfq"), /Legacy XLS/);
});
test("formulas including cached approved prices and namespace-prefixed formulas are rejected", async () => {
  for (const formula of ["<f>HYPERLINK(\"https://attacker.invalid\")</f>", '<s:f xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main">1+1</s:f>']) {
    await rejected(await mutate(files => sheet(files, xml => xml.replace("<v>2</v>", `${formula}<v>2</v>`))));
  }
});
test("DTD/entity expansion and deeply nested XML cannot reach the spreadsheet parser", async () => {
  await rejected(await mutate(files => sheet(files, xml => xml.replace("<worksheet", '<!DOCTYPE worksheet [<!ENTITY boom "payload">]><worksheet'))));
  await rejected(await mutate(files => sheet(files, xml => xml.replace("</worksheet>", "<n>".repeat(40) + "</n>".repeat(40) + "</worksheet>"))));
});
test("external relationships, macros and embedded objects are rejected even on unused sheets", async () => {
  for (const extra of ["xl/externalLinks/externalLink1.xml", "xl/vbaProject.bin", "xl/embeddings/object.bin"]) {
    await rejected(await mutate(files => { files[extra] = strToU8("<x/>"); }));
  }
  await rejected(await mutate(files => { files["xl/_rels/unsafe.xml.rels"] = strToU8('<Relationships><Relationship TargetMode="External" Target="https://attacker.invalid"/></Relationships>'); }));
  await rejected(await mutate(files => { files["[Content_Types].xml"] = strToU8(strFromU8(files["[Content_Types].xml"]).replace("spreadsheetml.sheet.main", "ms-excel.sheet.macroEnabled.main")); }));
});
test("sparse huge coordinates and excessive columns are rejected before allocating worksheet grids", async () => {
  for (const ref of ["A1048576", "XFD1", "A9999999999999999999999", "A0"]) {
    await rejected(await mutate(files => sheet(files, xml => xml.replace('r="A1"', `r="${ref}"`))));
  }
  await rejected(await mutate(files => sheet(files, xml => xml.replace('<row r="1"', '<row r="502"'))));
});
test("ZIP bombs and excessive entries are bounded independently of compressed upload size", async () => {
  await rejected(await mutate(files => { files["xl/bomb.xml"] = strToU8(" ".repeat(9 * 1024 * 1024)); }));
  await rejected(await mutate(files => { for (let n = 0; n < 3; n++) files[`xl/bomb${n}.xml`] = strToU8('<x>' + " ".repeat(6 * 1024 * 1024) + '</x>'); }));
  await rejected(await mutate(files => { for (let n = 0; n < 101; n++) files[`xl/extra${n}.xml`] = strToU8('<x/>'); }));
  assert.equal(MAX_EXPANDED, 16 * 1024 * 1024);
});
test("unsafe archive paths and prototype property names do not pollute objects", async () => {
  for (const path of ["../escape.xml", "/absolute.xml", "xl/../escape.xml"]) {
    await rejected(await mutate(files => { Object.defineProperty(files, path, { value: strToU8('<x/>'), enumerable: true }); }));
  }
  const prototypeEntry = await mutate(files => { files.evilnamex = strToU8('<x/>'); });
  // Patch both ZIP filename headers; ZIP CRC covers content, not filenames.
  let position = prototypeEntry.indexOf("evilnamex");
  while (position >= 0) { prototypeEntry.write("__proto__", position); position = prototypeEntry.indexOf("evilnamex", position + 9); }
  await rejected(prototypeEntry);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
test("duplicate ZIP filenames and encrypted entries fail before spreadsheet parsing", async () => {
  const duplicate = await mutate(files => { files["xl/workboox.xml"] = files["xl/workbook.xml"]; });
  let at = duplicate.indexOf("xl/workboox.xml");
  while (at >= 0) { duplicate.write("xl/workbook.xml", at); at = duplicate.indexOf("xl/workboox.xml", at + 15); }
  await rejected(duplicate);
  const encrypted = Buffer.from(await fixture());
  const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  await rejected(encrypted);
});
test("false uncompressed size metadata cannot bypass actual decompression validation", async () => {
  const bytes = await mutate(files => { files["xl/bomb.xml"] = strToU8(" ".repeat(9 * 1024 * 1024)); });
  let at = bytes.indexOf("xl/bomb.xml");
  while (at >= 0) {
    // Filename starts 30 bytes after a local header, 46 after a central header.
    if (bytes.readUInt32LE(at - 30) === 0x04034b50) bytes.writeUInt32LE(10, at - 8);
    else if (bytes.readUInt32LE(at - 46) === 0x02014b50) bytes.writeUInt32LE(10, at - 22);
    at = bytes.indexOf("xl/bomb.xml", at + 11);
  }
  await rejected(bytes);
});
test("non-finite numbers, boolean and date spreadsheet cells cannot become approved prices", async () => {
  await rejected(await mutate(files => sheet(files, xml => xml.replace("<v>2</v>", "<v>1e999</v>"))));
  for (const value of [true, new Date("2026-01-01")]) {
    const bytes = await writeXlsxFile([["code", "description", "unit", "price"], ["A", "Part", "pcs", value]], { dateFormat: "yyyy-mm-dd" }).toBuffer();
    await assert.rejects(spreadsheetCsv(bytes, 5001), /unsafe spreadsheet/);
  }
});
