import { currentUser } from '@/lib/server/auth';
import { roleDestination } from '@/lib/auth-policy';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await currentUser();
  redirect(user ? roleDestination(user) : '/login');
}
