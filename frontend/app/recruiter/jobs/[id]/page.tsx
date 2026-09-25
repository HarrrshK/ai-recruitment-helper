import { RecruiterJobEditor } from "@/components/recruiter/jobs";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <RecruiterJobEditor key={id} jobId={id} />; }
