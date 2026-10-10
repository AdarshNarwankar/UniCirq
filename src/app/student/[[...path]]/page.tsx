import { notFound } from 'next/navigation';
import { requirePageRole } from '@/lib/server/auth';
import { Module } from '@/components/module';
export default async function Page({params,searchParams}:{params:Promise<{path?:string[]}>;searchParams:Promise<Record<string,string>>}){await requirePageRole('student');const {path=[]}=await params;if(path.length>2||!['','marketplace','rentals','hardware','services','saved','listings','create','requests','messages','activity','managed-sale','support','profile','settings','deals','notifications'].includes(path[0]??'')||(path.length===2&&path[0]!=='listings')||(path[0]==='listings'&&!path[1]))notFound();return <Module role="student" path={path} query={await searchParams}/>}
