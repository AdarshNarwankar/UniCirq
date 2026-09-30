import { requirePageRole } from '@/lib/server/auth';
import { readSnapshot } from '@/lib/server/repository';
import type { Role } from '@/lib/domain';
import { AppProvider } from './provider';
import { Shell } from './shell';
export async function ProtectedLayout({role,children}:{role:Role;children:React.ReactNode}){const user=await requirePageRole(role);const snapshot=await readSnapshot(user);return <AppProvider initial={snapshot}><Shell>{children}</Shell></AppProvider>}
