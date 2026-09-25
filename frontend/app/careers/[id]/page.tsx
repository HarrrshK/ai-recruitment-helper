import { CandidateJobDetail } from "@/components/candidate-jobs";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <div className="candidate-workspace mx-auto max-w-7xl px-5 py-10 md:px-8"><CandidateJobDetail key={id} jobId={id} /></div>; }
