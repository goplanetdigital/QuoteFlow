import Link from "next/link";
import QuoteWorkspace from "../components/QuoteWorkspace";

export default function WorkspacePage() {
  return (
    <main>
      <section className="hero">
        <div className="badge">QuoteFlow MVP-01</div>
        <h1>RFQ review workspace.</h1>
        <p>
          Upload a CSV RFQ, match it against approved catalogue data,
          surface uncertain lines, and export only approved quotation rows.
        </p>
        <div className="actions">
          <Link className="secondary" href="/">Back to overview</Link>
        </div>
      </section>

      <QuoteWorkspace />
    </main>
  );
}
