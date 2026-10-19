'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import type { Notification } from '@/lib/domain';
import { useApp } from './provider';

export function NotificationLink({ notification, className, children }: { notification: Notification; className?: string; children: ReactNode }) {
  const { data, run, toast } = useApp();
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const inFlight = useRef<Promise<unknown> | null>(null);
  const href = notification.href.replace(/^\/(student|business|admin)/, '/' + data.user.role);

  function markRead() {
    if (notification.read) return Promise.resolve();
    if (!inFlight.current) {
      inFlight.current = run({ type: 'read_notifications', notification_id: notification.id })
        .finally(() => { inFlight.current = null; });
    }
    return inFlight.current;
  }

  return <Link href={href} className={className} aria-busy={opening || undefined} onClick={async event => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      void markRead().catch(() => toast('Could not mark this notification as read. Try again from your notifications.'));
      return;
    }
    if (notification.read) return;
    event.preventDefault();
    if (opening) return;
    setOpening(true);
    try {
      await markRead();
      router.push(href);
    } catch {
      toast('Could not open this notification. Please try again.');
    } finally {
      setOpening(false);
    }
  }} onAuxClick={event => {
    if (event.button === 1) void markRead().catch(() => toast('Could not mark this notification as read. Try again from your notifications.'));
  }}>{children}</Link>;
}
