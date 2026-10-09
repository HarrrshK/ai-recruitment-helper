import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceShell } from '@/components/recruitment/workspace-shell';
import { Overview } from '@/components/recruitment/workspace-views';
import { pageHead } from '@/components/recruitment/data';
export const Route = createFileRoute("/")({
  head: () => pageHead('HR overview', 'Your recruitment pipeline, recent candidates, interviews, and contextual hiring insights in one workspace.'),
  component: Index,
});
function Index() {
  return <WorkspaceShell><Overview /></WorkspaceShell>;
}
