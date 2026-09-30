'use client';
import { useApp } from './provider';
import { AdminShell } from './admin-dashboard';
import { MemberShell } from './member-shell';

export function Shell({ children }: { children: React.ReactNode }) {
  const { data } = useApp();
  return data.user.role === 'admin'
    ? <AdminShell>{children}</AdminShell>
    : <MemberShell>{children}</MemberShell>;
}
