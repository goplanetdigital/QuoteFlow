import Link from "next/link";
import QuoteWorkspace from "../components/QuoteWorkspace";

export default function WorkspacePage() {
  return (
    <main>
      <section className="hero">
        <div className="badge">QuoteFlow MVP-03</div>
        <h1>From RFQ file to review-ready quotation.</h1>
        <p>
          Upload PDF, CSV, or Excel RFQs, match against your approved catalogue,
          resolve uncertain lines, and generate quotation Excel or PDF-ready output.
        </p>
        <div className="actions">
          <Link className="secondary" href="/">Back to overview</Link>
        </div>
      </section>

      <QuoteWorkspace />
    </main>
  );
}
