import { notFound } from 'next/navigation';
import { requirePageRole } from '@/lib/server/auth';
import { Module } from '@/components/module';
export default async function Page({params}:{params:Promise<{path?:string[]}>}){await requirePageRole('business');const {path=[]}=await params;if(path.length>1||!['','deals','profile','settings','support','notifications','billing'].includes(path[0]??''))notFound();return <Module role="business" path={path}/>}
