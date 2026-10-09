import { redirect } from 'next/navigation';
import { authenticationCapabilities, demoEnabled } from '@/lib/server/config';
import { currentUser } from '@/lib/server/auth';
import { Login } from '@/components/login';
export const dynamic='force-dynamic';
export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string|string[]}>}){
 let actor=null;let serviceError=false;try{actor=await currentUser();}catch{serviceError=true;}
 if(actor)redirect('/');
 const query=await searchParams;
 return <Login demo={demoEnabled()} capabilities={authenticationCapabilities()} oauthError={Boolean(query.error)} accountNotLinked={(Array.isArray(query.error)?query.error:[query.error]).includes('account_not_linked')} serviceError={serviceError}/>;
}
