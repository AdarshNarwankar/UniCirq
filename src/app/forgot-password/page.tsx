import { authenticationCapabilities } from '@/lib/server/config';
import { Login } from '@/components/login';
export const dynamic='force-dynamic';
export default function ForgotPasswordPage(){return <Login mode="forgot" demo={false} capabilities={authenticationCapabilities()}/>;}
