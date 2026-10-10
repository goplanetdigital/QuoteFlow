declare module "pdf-parse/lib/pdf-parse.js" {
  type PDFResult = { numpages: number; text: string };
  export default function parse(data: Uint8Array): Promise<PDFResult>;
}
declare module "pdf-parse" {
  type PDFResult = { numpages: number; text: string };
  export default function parse(data: Uint8Array): Promise<PDFResult>;
}
