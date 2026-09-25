import { RecruiterInterviewDetail } from "@/components/recruiter/interviews";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <RecruiterInterviewDetail key={id} interviewId={id} />; }
