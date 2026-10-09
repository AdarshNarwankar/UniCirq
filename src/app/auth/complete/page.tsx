import { currentUser } from '@/lib/server/auth';
import { roleDestination } from '@/lib/auth-policy';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function CompleteSignIn() {
  let user;
  try { user = await currentUser(); } catch { redirect('/login?error=session'); }
  redirect(user ? roleDestination(user) : '/login?error=session');
}
