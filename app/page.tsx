import Link from "next/link";

const demoRows = [
  { code: "CBL-2C-1.5", description: "2 Core Cable 1.5mm", qty: "120 m", match: "Exact", price: "$0.82", status: "Ready" },
  { code: "SW20", description: "20 amp double pole wall switch", qty: "12 pcs", match: "Possible", price: "$12.40", status: "Review" },
  { code: "DB-12W", description: "Distribution board 12 way", qty: "3 pcs", match: "Exact", price: "No approved price", status: "Blocked" }
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="badge">QuoteFlow</div>
        <h1>Turn messy RFQs into review-ready quotations.</h1>
        <p>
          Upload an RFQ, match it against approved catalogue data, surface uncertain
          lines, and export only quotation rows that are safe to use.
        </p>

        <div className="actions">
          <Link className="primary" href="/workspace">Open RFQ workspace</Link>
          <a className="secondary" href="#how">See how it works</a>
        </div>
      </section>

      <section id="how" className="steps">
        <article>
          <span>01</span>
          <h2>Upload</h2>
          <p>Upload PDF, CSV, or Excel RFQs plus your approved catalogue or price list.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Match & review</h2>
          <p>Compare each source line with approved catalogue items and flag uncertainty.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Quote</h2>
          <p>Resolve review items, then generate a clean Excel or print-ready PDF quotation.</p>
        </article>
      </section>

      <section className="workspace preview-workspace">
        <div className="workspace-head">
          <div>
            <div className="eyebrow">Synthetic preview</div>
            <h2>Quotation review</h2>
            <p className="muted">Three lines showing the three key review states.</p>
          </div>
          <Link className="primary compact-link" href="/workspace">Try live workspace</Link>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Match</th>
                <th>Approved price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {demoRows.map((row) => (
                <tr key={row.code}>
                  <td>{row.code}</td>
                  <td>{row.description}</td>
                  <td>{row.qty}</td>
                  <td>{row.match}</td>
                  <td>{row.price}</td>
                  <td><span className={"status " + row.status.toLowerCase()}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mvp-note">
        <div className="eyebrow">MVP boundary</div>
        <h2>Safe first, then faster.</h2>
        <p>
          QuoteFlow does not invent prices or silently accept uncertain catalogue matches.
          Review and blocked rows stay visible until they are resolved.
        </p>
      </section>
    </main>
  );
}
