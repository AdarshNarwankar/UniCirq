import { notFound } from 'next/navigation';
import { requirePageRole } from '@/lib/server/auth';
import { Module } from '@/components/module';
export default async function Page({params}:{params:Promise<{path?:string[]}>}){await requirePageRole('admin');const {path=[]}=await params;if(path.length>1||!['','analytics','moderation','verifications','support','audit','profile','settings','notifications'].includes(path[0]??''))notFound();return <Module role="admin" path={path}/>}
