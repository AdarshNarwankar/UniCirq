import { notFound, redirect } from 'next/navigation';
import { requirePageRole } from '@/lib/server/auth';
import { Module } from '@/components/module';
export default async function Page({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole('student');
  const { path = [] } = await params;
  const page = path[0] ?? '';
  const isDetail = path.length === 2 && (page === 'listings' || page === 'sell' && path[1] === 'new');
  if (path.length > 2 || !['', 'buy', 'sell', 'marketplace', 'rentals', 'hardware', 'services', 'saved', 'listings', 'create', 'requests', 'messages', 'activity', 'managed-sale', 'support', 'profile', 'settings', 'deals', 'notifications'].includes(page) || path.length === 2 && !isDetail || page === 'listings' && !path[1]) notFound();
  const rawQuery = await searchParams;
  const query = Object.fromEntries(Object.entries(rawQuery).map(([key, value]) => [key, (Array.isArray(value) ? value[0] : value) ?? '']));
  if (page === 'marketplace') {
    const search = new URLSearchParams(query).toString();
    redirect('/student/buy' + (search ? '?' + search : ''));
  }
  return <Module role="student" path={path} query={query} />;
}
