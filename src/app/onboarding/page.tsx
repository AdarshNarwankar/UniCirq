import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth';
import { demoEnabled } from '@/lib/server/config';
import { readUniversityOptions } from '@/lib/server/onboarding';
import { Onboarding } from '@/components/onboarding';
export const dynamic='force-dynamic';
export default async function OnboardingPage(){
 let actor;try{actor=await currentUser();}catch{return <Onboarding actorName="" universities={[]} demo={demoEnabled()} loadFailed/>;}
 if(!actor)redirect('/login');
 if(actor.college_id||actor.role!=='student')redirect('/');
 let universities:Awaited<ReturnType<typeof readUniversityOptions>>=[];let loadFailed=false;
 try{universities=await readUniversityOptions(actor);}catch{loadFailed=true;}
 return <Onboarding actorName={actor.name} universities={universities} demo={demoEnabled()} loadFailed={loadFailed}/>;
}
