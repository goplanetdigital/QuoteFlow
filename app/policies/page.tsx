export default function Page() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <main className="workspace">
      <h1>Support and test service terms</h1>
      <p>
        QuoteFlow is currently a test-mode pilot. Stripe test payments do not
        charge real money. A test service fee covers one saved quotation export,
        separate from the quotation’s goods or services subtotal.
      </p>
      <h2>Support and refunds</h2>
      <p>
        {email ? (
          <a href={`mailto:${email}`}>Contact {email}</a>
        ) : (
          "A support contact must be configured before public release."
        )}{" "}
        Include your job ID, without sending card details. Test charges have no
        monetary refund. Any future paid release requires owner-approved refund
        terms before live charging is enabled.
      </p>
      <h2>Privacy and delivery</h2>
      <p>
        RFQs, catalogues and saved quotations are stored privately for delivery
        and troubleshooting. Access uses an HTTP-only cookie in the browser that
        created the job. Payment is processed by Stripe; QuoteFlow does not
        store card details. QuoteFlow does not send files to an AI provider.
        Cookies expire after seven days; owners must run the documented
        seven-day data cleanup. Contact support for deletion. Clearing cookies
        removes self-service access to saved jobs.
      </p>
      <h2>Your responsibilities</h2>
      <p>
        Upload files you are permitted to process. Review extracted quantities,
        units, matches and catalogue prices before paying. Uncertain and
        unpriced lines stay excluded until explicitly resolved. QuoteFlow
        creates a draft for your review and does not guarantee supplier
        availability or commercial terms.
      </p>
      <p>
        <a href="/">Return to QuoteFlow</a>
      </p>
    </main>
  );
}
