import { notFound } from 'next/navigation';
import { requirePageRole } from '@/lib/server/auth';
import { Module } from '@/components/module';
import { isAdminPage } from '@/lib/admin-workspaces';
export default async function Page({params}:{params:Promise<{path?:string[]}>}){await requirePageRole('admin');const {path=[]}=await params;if(!isAdminPage(path))notFound();return <Module role="admin" path={path}/>}
