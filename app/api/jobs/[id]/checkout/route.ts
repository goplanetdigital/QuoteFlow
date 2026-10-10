import { NextRequest, NextResponse } from "next/server";
import {
  beginCheckout,
  createStripeSession,
} from "../../../../../lib/server/payment";
import {
  failure,
  jobHash,
  sameOrigin,
  validId,
} from "../../../../../lib/server/http";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const id = validId((await context.params).id);
    const url = await beginCheckout(
      id,
      jobHash(request, id),
      createStripeSession,
    );
    return NextResponse.json(
      { url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
