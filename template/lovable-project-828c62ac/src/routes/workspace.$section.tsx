import { createFileRoute, notFound } from '@tanstack/react-router';
import { WorkspaceShell } from '@/components/recruitment/workspace-shell';
import { SectionView } from '@/components/recruitment/workspace-views';
import { pageHead, sections, sectionTitles } from '@/components/recruitment/data';
export const Route = createFileRoute('/workspace/$section')({
  loader: ({ params }) => { const section = sections.find(s => s === params.section); if (!section) throw notFound(); return { section }; },
  head: ({ loaderData }) => pageHead(loaderData ? sectionTitles[loaderData.section] : 'Workspace unavailable', loaderData ? `Explore ${sectionTitles[loaderData.section].toLowerCase()} in your Hirely recruitment workspace.` : 'The requested workspace section is unavailable.'),
  component: SectionPage,
});
function SectionPage() { const { section } = Route.useLoaderData(); return <WorkspaceShell section={section}><SectionView section={section} /></WorkspaceShell>; }