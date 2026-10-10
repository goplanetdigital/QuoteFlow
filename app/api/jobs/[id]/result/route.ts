import { NextRequest } from "next/server";
import { failure, jobHash, validId } from "../../../../../lib/server/http";
import { AppError } from "../../../../../lib/server/config";
import { requireOwner } from "../../../../../lib/server/payment";
import { store } from "../../../../../lib/server/store";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const id = validId((await context.params).id);
    const job = await store.get(id);
    if (!job) throw new AppError(404, "Quotation job not found.");
    requireOwner(job, jobHash(request, id));
    if (job.state !== "ready")
      throw new AppError(
        402,
        "Your quotation is available after payment is confirmed.",
      );
    const format = request.nextUrl.searchParams.get("format");
    if (format !== "xlsx" && format !== "html")
      throw new AppError(400, "Choose Excel or printable HTML.");
    const bytes = format === "xlsx" ? job.excel : job.printable;
    if (!bytes)
      throw new AppError(503, "Quotation delivery is pending. Please retry.");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type":
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/html; charset=utf-8",
        "Content-Disposition": `${format === "xlsx" ? "attachment" : "inline"}; filename="quotation-${id}.${format}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
