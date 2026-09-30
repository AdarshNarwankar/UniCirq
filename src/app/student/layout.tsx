import { ProtectedLayout } from '@/components/protected-layout';
export const dynamic='force-dynamic';
export default function Layout({children}:{children:React.ReactNode}){return <ProtectedLayout role="student">{children}</ProtectedLayout>}
