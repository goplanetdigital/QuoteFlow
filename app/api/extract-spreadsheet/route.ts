import { guardedUpload } from "../../../lib/server/abuse";
import { NextResponse } from "next/server";
import { AppError } from "../../../lib/server/config";
import { boundedBody, failure, sameOrigin } from "../../../lib/server/http";
import { MAX_UPLOAD } from "../../../lib/server/input";
import { spreadsheetCsv } from "../../../lib/server/spreadsheet";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    return await guardedUpload(request, MAX_UPLOAD + 10000, async () => {
      const body = await boundedBody(request, MAX_UPLOAD + 10000);
      let form: FormData;
      try {
        form = await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type") ?? "" }, body: new Uint8Array(body) }).formData();
      } catch { throw new AppError(400, "Invalid upload request."); }
      const file = form.get("file"), kind = form.get("kind");
      if (!(file instanceof File) || !file.size || file.size > MAX_UPLOAD || (kind !== "rfq" && kind !== "catalogue"))
        throw new AppError(400, "Choose an RFQ or catalogue file smaller than 1.5 MB.");
      const ext = file.name.toLowerCase().split(".").pop();
      if (ext === "xls") throw new AppError(400, "Legacy XLS is unsupported. Save it as a values-only XLSX or CSV first.");
      if (ext !== "xlsx" && ext !== "csv") throw new AppError(400, "Use CSV or values-only XLSX.");
      const csv = ext === "csv" ? await file.text() : await spreadsheetCsv(Buffer.from(await file.arrayBuffer()), kind === "rfq" ? 501 : 5001);
      return NextResponse.json({ csv }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) { return failure(error); }
}
