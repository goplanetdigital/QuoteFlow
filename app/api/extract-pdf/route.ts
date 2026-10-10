import { boundedBody, failure } from "../../../lib/server/http";
import { MAX_UPLOAD, MAX_BODY } from "../../../lib/server/input";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_PDF_BYTES = MAX_UPLOAD;

export async function POST(request: Request) {
  try {
    const body = await boundedBody(request, MAX_BODY);
    const form = await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type") ?? "" }, body: new Uint8Array(body) }).formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "PDF file is required." }, { status: 400 });
    }

    if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "PDF must be between 1 byte and 1.5 MB." },
        { status: 400 }
      );
    }

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      return NextResponse.json({ error: "Only PDF files are accepted." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const parsed = await pdfParse(bytes);

    const text = String(parsed.text ?? "").trim();

    if (!text) {
      return NextResponse.json(
        {
          error:
            "No selectable text was found in this PDF. Scanned-image PDFs need OCR, which is not enabled in this MVP."
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      text,
      pages: parsed.numpages ?? null,
      filename: file.name
    });
  } catch (error) { return failure(error); }
}
