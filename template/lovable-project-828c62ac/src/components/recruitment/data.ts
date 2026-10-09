export const candidates = [
  { id: '1', name: 'Priya Sharma', email: 'priya.sharma@email.com', initials: 'PS', role: 'Senior Product Designer', experience: '6 years', status: 'Shortlisted', match: 96, skills: ['Figma', 'UX Research', 'Design Systems'], activity: '2 hours ago' },
  { id: '2', name: 'Alex Morgan', email: 'alex.morgan@email.com', initials: 'AM', role: 'Frontend Engineer', experience: '4 years', status: 'Interview', match: 94, skills: ['React', 'TypeScript', 'Next.js'], activity: '3 hours ago' },
  { id: '3', name: 'James Wilson', email: 'james.wilson@email.com', initials: 'JW', role: 'Backend Engineer', experience: '5 years', status: 'Screening', match: 91, skills: ['Node.js', 'PostgreSQL', 'AWS'], activity: '5 hours ago' },
  { id: '4', name: 'Sarah Chen', email: 'sarah.chen@email.com', initials: 'SC', role: 'Product Manager', experience: '7 years', status: 'Shortlisted', match: 89, skills: ['Strategy', 'Agile', 'Analytics'], activity: '6 hours ago' },
  { id: '5', name: 'Michael Davis', email: 'michael.davis@email.com', initials: 'MD', role: 'DevOps Engineer', experience: '3 years', status: 'Applied', match: 87, skills: ['Docker', 'Kubernetes', 'AWS'], activity: '8 hours ago' },
];
export const jobs = [
  { title: 'Senior Product Designer', department: 'Design', location: 'Remote', applicants: 86, shortlisted: 12, skills: ['Figma', 'UX Research', 'Design Systems'] },
  { title: 'Frontend Engineer', department: 'Engineering', location: 'Bengaluru, India', applicants: 124, shortlisted: 18, skills: ['React', 'TypeScript', 'Next.js'] },
  { title: 'Backend Engineer', department: 'Engineering', location: 'Remote', applicants: 98, shortlisted: 14, skills: ['Node.js', 'PostgreSQL', 'AWS'] },
  { title: 'Product Manager', department: 'Product', location: 'Hybrid', applicants: 67, shortlisted: 9, skills: ['Strategy', 'Agile', 'Analytics'] },
];
export const sections = ['candidates', 'jobs', 'interviews', 'ai-insights', 'analytics', 'settings'] as const;
export type Section = typeof sections[number];
export type Persona = 'hr' | 'candidate' | 'admin';
export const sectionTitles: Record<Section, string> = { candidates: 'Candidates', jobs: 'Jobs', interviews: 'Interviews', 'ai-insights': 'AI Insights', analytics: 'Analytics', settings: 'Settings' };
export function pageHead(title: string, description: string) {
  return { meta: [{ title: `${title} — Hirely` }, { name: 'description', content: description }, { property: 'og:title', content: `${title} — Hirely` }, { property: 'og:description', content: description }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }] };
}