import { createFileRoute, notFound } from '@tanstack/react-router';
import { WorkspaceShell } from '@/components/recruitment/workspace-shell';
import { CandidateProfile } from '@/components/recruitment/workspace-views';
import { candidates, pageHead } from '@/components/recruitment/data';
export const Route = createFileRoute('/candidates/$candidateId')({
  loader: ({ params }) => { const candidate = candidates.find(c => c.id === params.candidateId); if (!candidate) throw notFound(); return { candidate }; },
  head: ({ loaderData }) => pageHead(loaderData ? `${loaderData.candidate.name} · Candidate profile` : 'Candidate unavailable', 'Candidate experience, application timeline, and contextual AI assessment.'),
  component: ProfilePage,
});
function ProfilePage() { const { candidate } = Route.useLoaderData(); return <WorkspaceShell section="candidates"><CandidateProfile id={candidate.id} /></WorkspaceShell>; }