"use client";
import { useEffect, useState } from "react";
type Status = {
  state: string;
  subtotal: number;
  quoteCurrency: string;
  amount: number;
  currency: string;
  excludedCount: number;
  lines: {
    description: string;
    quantity: number;
    unit: string;
    matchedCode: string | null;
    approvedUnitPrice: number | null;
    reviewStatus: string;
  }[];
};
export default function JobStatus({
  id,
  cancelled = false,
}: {
  id: string;
  cancelled?: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const data = await r.json();
        if (!active) return;
        if (!r.ok) {
          setError(data.error || "Unable to load this quotation.");
          return;
        }
        setError("");
        setStatus(data);
        if (data.state === "awaiting_payment" || data.state === "processing")
          timer = setTimeout(poll, 4000);
      } catch {
        if (active)
          setError(
            "Unable to check payment. Refresh to retry; your saved job is preserved.",
          );
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, refresh]);
  async function pay() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(id)}/checkout`, {
        method: "POST",
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Unable to open checkout. Retry from this page.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace">
      <h1>Your saved quotation</h1>
      <p>Job: {id}</p>
      {cancelled ? (
        <p>
          Checkout was cancelled. Your reviewed quotation is saved; you can
          return to payment below.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {!status && !error ? (
        <p role="status">Loading quotation status…</p>
      ) : null}
      {status ? (
        <>
          <p role="status">
            {status.state === "ready"
              ? "Payment confirmed. Your quotation is ready."
              : status.state === "payment_failed"
                ? "Payment failed. Return to the workspace to create a new payment attempt, or contact support."
                : status.state === "expired"
                  ? "Checkout expired. Create a new quotation from the workspace."
                  : "Waiting for verified payment. A success redirect alone does not confirm payment."}
          </p>
          <p>
            Quotation subtotal: {status.quoteCurrency}{" "}
            {status.subtotal.toFixed(2)}. {status.excludedCount} unresolved
            lines are excluded.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Qty</th>
                  <th>Selected code</th>
                  <th>Catalogue price</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {status.lines.map((line, i) => (
                  <tr key={i}>
                    <td>{line.description}</td>
                    <td>
                      {line.quantity} {line.unit}
                    </td>
                    <td>{line.matchedCode ?? "Unmatched"}</td>
                    <td>{line.approvedUnitPrice ?? "No price"}</td>
                    <td>{line.reviewStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {status.state === "ready" ? (
            <div className="export-actions">
              <a href={`/api/jobs/${id}/result?format=xlsx`}>Download Excel</a>
              <a
                href={`/api/jobs/${id}/result?format=html`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Printable quotation / Save as PDF
              </a>
            </div>
          ) : null}
          {status.state === "awaiting_payment" ? (
            <button onClick={pay} disabled={busy}>
              {busy
                ? "Opening checkout…"
                : `Pay ${new Intl.NumberFormat("en", { style: "currency", currency: status.currency }).format(status.amount / 100)} in test mode`}
            </button>
          ) : null}
        </>
      ) : null}
      <p>
        <button
          className="secondary-button"
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh status
        </button>
      </p>
      <p>
        Keep this browser’s cookies to access this job. Delivery is available
        here after verified payment. Use Print → Save as PDF on the printable
        quotation.
      </p>
      <p>
        <a href="/">Return to workspace</a> ·{" "}
        <a href="/policies">Support and policies</a>
      </p>
    </section>
  );
}
