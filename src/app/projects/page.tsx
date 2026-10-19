import { redirect } from 'next/navigation';

// Projects live under V-Run now (each one has Chat and ▶ V-Run).
export default function ProjectsPage() {
  redirect('/v-run');
}
