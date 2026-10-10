import { UploadLimitError } from "./abuse";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AppError, applicationOrigin } from "./config";
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function jobHash(request: NextRequest, id: string) {
  const token = request.cookies.get(`qf_job_${id}`)?.value;
  return token && /^[a-f0-9]{64}$/.test(token) ? hashToken(token) : "";
}
export function validId(id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw new AppError(404, "Quotation job not found.");
  return id;
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== applicationOrigin())
    throw new AppError(
      403,
      "Please start checkout from the QuoteFlow workspace.",
    );
}
export function failure(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store", ...(error instanceof UploadLimitError ? { "Retry-After": String(error.retryAfter) } : {}) } },
    );
  console.error(
    "QuoteFlow request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json(
    {
      error:
        "Unable to complete this request. Retry or contact support with your job ID.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
export async function boundedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max)
    throw new AppError(413, "Upload is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "Request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new AppError(408, "Upload timed out. Please retry."));
      void reader.cancel().catch(() => {});
    }, 15000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (expired) throw new AppError(408, "Upload timed out. Please retry.");
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new AppError(413, "Upload is too large."); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer!); }
}
