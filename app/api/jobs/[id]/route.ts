import { NextRequest, NextResponse } from "next/server";
import { failure, jobHash, validId } from "../../../../lib/server/http";
import { AppError } from "../../../../lib/server/config";
import { requireOwner } from "../../../../lib/server/payment";
import { store } from "../../../../lib/server/store";
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
    return NextResponse.json(
      {
        id,
        state: job.state,
        subtotal: job.snapshot.subtotal,
        quoteCurrency: job.snapshot.meta.currency,
        excludedCount: job.snapshot.excludedCount,
        lines: job.snapshot.lines,
        amount: job.amount,
        currency: job.currency,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
