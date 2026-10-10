import JobStatus from "../../components/JobStatus";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <JobStatus id={(await params).id} />;
}
