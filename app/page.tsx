const demoRows = [
  { code: "CBL-2C-1.5", description: "2 Core Cable 1.5mm", qty: 120, unit: "m", match: "Exact match", price: "$0.82", status: "Ready" },
  { code: "SW-20A", description: "20A Double Pole Switch", qty: 12, unit: "pcs", match: "Possible match", price: "Review", status: "Review" },
  { code: "DB-12W", description: "12 Way Distribution Board", qty: 3, unit: "pcs", match: "No approved price", price: "—", status: "Blocked" }
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="badge">QuoteFlow MVP</div>
        <h1>Turn messy RFQs into quotation drafts.</h1>
        <p>
          Extract line items, match approved catalogue products, flag uncertainty,
          and prepare a clean quote without inventing prices.
        </p>
        <div className="actions">
          <a className="primary" href="#workspace">Try demo workspace</a>
          <a className="secondary" href="#how">See how it works</a>
        </div>
      </section>

      <section id="how" className="steps">
        <article><span>01</span><h2>Upload</h2><p>RFQ PDF, spreadsheet, or supplier quote.</p></article>
        <article><span>02</span><h2>Review</h2><p>Check extracted lines and uncertain matches.</p></article>
        <article><span>03</span><h2>Quote</h2><p>Use approved pricing and export the draft.</p></article>
      </section>

      <section id="workspace" className="workspace">
        <div className="workspace-head">
          <div>
            <div className="eyebrow">Synthetic demo</div>
            <h2>Quotation review</h2>
          </div>
          <button>Upload RFQ</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Description</th><th>Qty</th><th>Match</th><th>Price</th><th>Status</th></tr></thead>
            <tbody>
              {demoRows.map((row) => (
                <tr key={row.code}>
                  <td>{row.code}</td><td>{row.description}</td><td>{row.qty} {row.unit}</td>
                  <td>{row.match}</td><td>{row.price}</td>
                  <td><span className={"status " + row.status.toLowerCase()}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="summary">
          <div><strong>3</strong><span>RFQ lines</span></div>
          <div><strong>1</strong><span>Ready</span></div>
          <div><strong>1</strong><span>Needs review</span></div>
          <div><strong>1</strong><span>Blocked</span></div>
        </div>
      </section>
    </main>
  );
}
