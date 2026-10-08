import QuoteWorkspace from "./components/QuoteWorkspace";

export default function Home() {
  return (
    <main>
      <section className="hero upload-first-hero">
        <div className="badge">QuoteFlow</div>
        <h1>Upload your RFQ. Build the quotation here.</h1>
        <p>
          Add your RFQ and approved catalogue or price list, review uncertain matches,
          then generate Excel or PDF-ready quotation output without leaving this page.
        </p>
      </section>

      <QuoteWorkspace />

      <section className="mvp-note">
        <div className="eyebrow">How it works</div>
        <h2>Upload → Review → Quote</h2>
        <p>
          QuoteFlow never invents prices. Uncertain matches and missing approved prices
          stay out of the quotation until you review them.
        </p>
      </section>
    </main>
  );
}
