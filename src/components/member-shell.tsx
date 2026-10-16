'use client';
import { WorkspaceShell } from './workspace-shell';
export function MemberShell({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
