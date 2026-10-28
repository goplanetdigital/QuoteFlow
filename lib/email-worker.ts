import { NextRequest, NextResponse } from "next/server";
import { dispatchRequest } from "./email-dispatch";
import { workerAuthorized } from "./delivery-policy";

// Vercel Cron invokes GET. POST remains available for explicitly targeted jobs.
// Each tick is bounded; overlapping ticks use the same fenced database claims.
export async function workerTick(request: NextRequest) {
  if (!workerAuthorized(request.headers.get("authorization")))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const run = (action: string) => dispatchRequest(new NextRequest(request.url, {
    method: "POST", headers: request.headers, body: JSON.stringify({ action, dryRun: false })
  }));
  const dispatched = await run("dispatch");
  const reconciled = await run("reconcile");
  return NextResponse.json({ dispatch: await dispatched.json(), reconcile: await reconciled.json() }, {
    status: [dispatched.status, reconciled.status].some(status => status >= 400 && status !== 409) ? 503 : 200,
    headers: { "Cache-Control": "no-store" }
  });
}
