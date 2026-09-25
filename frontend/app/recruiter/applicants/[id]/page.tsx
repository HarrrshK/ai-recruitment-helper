import { RecruiterApplicant } from "@/components/recruiter/applicants";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <RecruiterApplicant key={id} applicationId={id} />; }
