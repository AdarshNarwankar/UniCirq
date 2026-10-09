import { redirect } from 'next/navigation';
import { authenticationCapabilities, demoEnabled } from '@/lib/server/config';
import { currentUser } from '@/lib/server/auth';
import { Login } from '@/components/login';
export const dynamic='force-dynamic';
export default async function SignupPage(){
 let actor=null;let serviceError=false;try{actor=await currentUser();}catch{serviceError=true;}
 if(actor)redirect('/');
 return <Login mode="signup" demo={demoEnabled()} capabilities={authenticationCapabilities()} serviceError={serviceError}/>;
}
