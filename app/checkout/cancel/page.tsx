import JobStatus from "../../components/JobStatus";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { job } = await searchParams;
  return job ? (
    <JobStatus id={job} cancelled />
  ) : (
    <p>
      Checkout cancelled. <a href="/">Return to QuoteFlow</a>
    </p>
  );
}
