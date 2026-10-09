import { createFileRoute } from '@tanstack/react-router';
import { WorkspaceShell } from '@/components/recruitment/workspace-shell';
import { AdminView } from '@/components/recruitment/workspace-views';
import { pageHead } from '@/components/recruitment/data';
export const Route = createFileRoute('/admin')({ head: () => pageHead('Developer admin', 'A platform-level view of organizations, service health, and system activity.'), component: AdminPage });
function AdminPage() { return <WorkspaceShell persona="admin"><AdminView /></WorkspaceShell>; }