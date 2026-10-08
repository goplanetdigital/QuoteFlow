import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "PDF file is required." }, { status: 400 });
    }

    if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "PDF must be between 1 byte and 10 MB." },
        { status: 400 }
      );
    }

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      return NextResponse.json({ error: "Only PDF files are accepted." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfParse = (await import("pdf-parse")).default;
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
  } catch (error) {
    console.error("QuoteFlow PDF extraction failed", error);
    return NextResponse.json(
      { error: "Unable to extract this PDF. Please try CSV or Excel if the PDF is scanned." },
      { status: 500 }
    );
  }
}
