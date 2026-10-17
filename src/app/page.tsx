import { currentUser } from '@/lib/server/auth';
import { roleDestination } from '@/lib/auth-policy';
import { redirect } from 'next/navigation';
import { Landing } from '@/components/landing';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await currentUser();
  if (user) redirect(roleDestination(user));
  return <Landing />;
}
