import QuoteWorkspace from "./components/QuoteWorkspace";

export default function Home() {
  return (
    <main>
      <section className="hero upload-first-hero">
        <div className="badge">QuoteFlow · by ALLSET.co</div>
        <h1>Turn your RFQ into a quotation, faster.</h1>
        <p>
          Upload a request for quotation and your approved catalogue or price list.
          Check uncertain matches, confirm pricing, and unlock both Excel and PDF
          quotation exports with one payment.
        </p>
        <p style={{ fontSize: 16, marginTop: 16 }}>
          From US$10 per quotation · No subscription required · Review before you pay
        </p>
        <a className="compact-link primary" href="#workspace" style={{ marginTop: 18 }}>
          Create your quotation ↓
        </a>
      </section>

      <QuoteWorkspace />

      <section className="mvp-note">
        <div className="eyebrow">Simple, transparent pricing</div>
        <h2>Pay once. Download Excel and PDF.</h2>
        <p>1–20 RFQ lines: US$10 · 21–100 lines: US$29 · 101–300 lines: US$59 · 301–1000 lines: US$99.</p>
        <p style={{ marginTop: 12 }}>Your final price depends on the number of RFQ lines. Payment is required only when you are ready to unlock exports.</p>
      </section>

      <section className="mvp-note">
        <div className="eyebrow">How it works</div>
        <h2>Upload → Review → Quote</h2>
        <p>
          1. Upload your RFQ and approved price list. 2. Review uncertain matches and
          missing prices. 3. Pay once to export the same quotation as PDF and Excel.
        </p>
        <p style={{ marginTop: 12 }}>
          QuoteFlow never invents prices. Uncertain matches and missing approved prices
          stay out of the quotation until you review them. Try the free demo to see
          sample exports before uploading your own files.
        </p>
      </section>
    </main>
  );
}
