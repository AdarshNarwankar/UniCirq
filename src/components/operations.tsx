'use client';
import { useMemo } from 'react';
import { AdminOverview } from './admin-dashboard';
import { AdminAnalytics } from './admin-analytics';
import { VerificationWorkspace } from './verification-workspace';
import { ModerationQueue, ListingsCatalogue } from './moderation-workspace';
import { AdminSupport, AdminSupportCenter } from './admin-support';
import { TrustSafety } from './trust-safety';
import { BusinessDashboard } from './member-dashboard';
import { useApp } from './provider';
import { useAdminFilters } from './admin-filters';
import { buildTrustSafety } from '@/lib/trust-safety';
import { adminTime } from '@/lib/admin-workspaces';
import { Empty, Heading } from './primitives';

export function Admin({view='overview'}:{view?:string}) {
  switch(view) {
    case 'overview': return <AdminOverview />;
    case 'analytics': return <AdminAnalytics />;
    case 'verifications': return <VerificationWorkspace />;
    case 'moderation': return <ListingsCatalogue />;
    case 'moderation-queue': return <ModerationQueue />;
    case 'trust-safety': return <TrustSafety />;
    case 'support': return <AdminSupport />;
    case 'support-center': return <AdminSupportCenter />;
    case 'audit': return <AdminAudit />;
    default: return <Empty title="Workspace unavailable." body="Choose an admin workspace from the navigation." />;
  }
}
function AdminAudit() {
  const {data}=useApp(), filters=useAdminFilters();
  const {audit}=useMemo(()=>buildTrustSafety(data,filters),[data,filters]);
  return <><Heading eyebrow="ACCOUNTABILITY" title="Audit log" subtitle="Recorded actions, authors and reasons. Campus, period and search filters apply to decisions." /><div className="panel table-wrap"><table><thead><tr><th>Action & reference</th><th>Reviewer</th><th>Reason</th><th>Recorded (IST)</th></tr></thead><tbody>{audit.map(event=><tr key={event.id}><td><strong>{event.action.replaceAll('_',' ').replaceAll('.',' · ')}</strong><small>{event.target_id.slice(0,8).toUpperCase()}</small></td><td>{data.profiles.find(person=>person.id===event.actor_id)?.name??'Administrator'}</td><td>{event.reason}</td><td><time dateTime={event.created_at}>{adminTime(event.created_at)}</time></td></tr>)}</tbody></table>{!audit.length&&<Empty title="No decisions match this view." body="Try another campus, period or search. New decisions appear here with their author and reason." />}</div></>;
}
export function BusinessOverview(){return <BusinessDashboard/>}
