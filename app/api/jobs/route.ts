import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { paymentConfig, AppError } from "../../../lib/server/config";
import {
  boundedBody,
  failure,
  hashToken,
  sameOrigin,
} from "../../../lib/server/http";
import {
  approveQuote,
  MAX_BODY,
  parseUpload,
  readMatches,
  readMeta,
} from "../../../lib/server/input";
import { CatalogueItem, RfqLine } from "../../../lib/quoteflow";
import { createJob } from "../../../lib/server/store";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const config = paymentConfig();
    const bytes = await boundedBody(request, MAX_BODY);
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      body: new Uint8Array(bytes),
    }).formData();
    const rfq = form.get("rfq");
    const catalogue = form.get("catalogue");
    if (
      !(rfq instanceof File) ||
      !(catalogue instanceof File) ||
      form.get("approved") !== "true"
    )
      throw new AppError(
        400,
        "Upload both files and confirm the reviewed catalogue prices.",
      );
    const [r, c] = await Promise.all([
      parseUpload(rfq, "rfq"),
      parseUpload(catalogue, "catalogue"),
    ]);
    const snapshot = approveQuote(
      r.rows as RfqLine[],
      c.rows as CatalogueItem[],
      readMatches(String(form.get("matches") ?? "{}")),
      readMeta(String(form.get("meta") ?? "")),
      rfq.name.slice(0, 200),
    );
    const id = randomUUID();
    const token = randomBytes(32).toString("hex");
    await createJob(
      {
        id,
        owner_hash: hashToken(token),
        snapshot,
        amount: config.amount,
        currency: config.currency,
        state: "awaiting_payment",
        session_id: null,
        checkout_url: null,
        session_expires: null,
        excel: null,
        printable: null,
      },
      [
        { kind: "rfq", filename: rfq.name.slice(0, 200), content: r.bytes },
        {
          kind: "catalogue",
          filename: catalogue.name.slice(0, 200),
          content: c.bytes,
        },
      ],
    );
    const response = NextResponse.json(
      {
        id,
        subtotal: snapshot.subtotal,
        excludedCount: snapshot.excludedCount,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(`qf_job_${id}`, token, {
      httpOnly: true,
      secure: config.origin.startsWith("https:"),
      sameSite: "lax",
      path: `/api/jobs/${id}`,
      maxAge: 7 * 86400,
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}
