import { CandidateJobDetail } from "@/components/candidate-jobs";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <CandidateJobDetail key={id} jobId={id} />; }
