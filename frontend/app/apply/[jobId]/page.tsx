import { redirect } from "next/navigation";
export default async function Page({ params }: { params: Promise<{ jobId: string }> }) { const { jobId } = await params; redirect(`/candidate/jobs/${jobId}`); }
