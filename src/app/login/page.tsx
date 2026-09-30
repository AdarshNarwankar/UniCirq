import { demoEnabled, authConfigured } from '@/lib/server/config';
import { Login } from '@/components/login';
export const dynamic='force-dynamic';
export default function LoginPage(){return <Login demo={demoEnabled()} configured={authConfigured()}/>}
