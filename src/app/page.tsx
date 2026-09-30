import { currentUser } from '@/lib/server/auth';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Home(){const user=await currentUser();redirect(user?'/'+user.role:'/login')}
