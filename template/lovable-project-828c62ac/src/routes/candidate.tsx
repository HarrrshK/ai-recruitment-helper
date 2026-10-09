import { createFileRoute } from '@tanstack/react-router';
import { WorkspaceShell } from '@/components/recruitment/workspace-shell';
import { CandidateView } from '@/components/recruitment/workspace-views';
import { pageHead } from '@/components/recruitment/data';
export const Route = createFileRoute('/candidate')({ head: () => pageHead('Candidate workspace', 'A personal view of applications, profile, and career opportunities.'), component: CandidatePage });
function CandidatePage() { return <WorkspaceShell persona="candidate"><CandidateView /></WorkspaceShell>; }