'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowLeft, ChartNoAxesCombined, CircleHelp, ClipboardCheck, LifeBuoy, MapPin, ShoppingBag, Users, Wallet, type LucideIcon } from 'lucide-react';
import { buildAdminAnalytics } from '@/lib/admin-analytics';
import { moneyLabel } from '@/lib/domain';
import { useApp } from './provider';
import { useAdminFilters } from './admin-filters';
import { BarChart, DonutChart, TrendChart, type ChartSeries } from './admin-charts';

export const activitySeries: ChartSeries[] = [
  { key: 'listings', label: 'New listings', color: '#1762ff' },
  { key: 'orders', label: 'Order requests', color: '#059669' },
  { key: 'users', label: 'New members', color: '#8b5cf6' },
];
export const campusSeries: ChartSeries[] = [
  { key: 'users', label: 'Members', color: '#8b5cf6' },
  { key: 'listings', label: 'Listings', color: '#1762ff' },
  { key: 'orders', label: 'Order requests', color: '#059669' },
];
const valueSeries: ChartSeries[] = [{ key: 'orderValue', label: 'Requested order value', color: '#1762ff' }];
const supportSeries: ChartSeries[] = [{ key: 'open', label: 'Open', color: '#f59e0b' }, { key: 'resolved', label: 'Resolved', color: '#059669' }];

function AnalyticsCard({ title, subtitle, icon: Icon, children, wide, id }: { title: string; subtitle: string; icon: LucideIcon; children: React.ReactNode; wide?: boolean; id?: string }) {
  return <section id={id} className={`admin-analytics-card${wide ? ' analytics-wide' : ''}`}>
    <header className="analytics-card-heading"><span className="metric-icon blue"><Icon size={20} /></span><div><h2>{title}</h2><p>{subtitle}</p></div></header>
    {children}
  </section>;
}

export function AnalyticsCoverage({ demo }: { demo: boolean }) {
  return <p className="analytics-coverage"><CircleHelp size={15} /><span>{demo ? 'Local demo · sample campus records.' : 'Charts cover the latest loaded records; large datasets may be incomplete.'} Dates use India Standard Time. Status charts show the current status of records created in the selected period.</span></p>;
}

export function AdminAnalytics() {
  const { data } = useApp();
  const { campus, days } = useAdminFilters();
  const analytics = useMemo(() => buildAdminAnalytics(data, { campus, days }), [data, campus, days]);
  const { totals } = analytics;
  const campusLabel = campus === 'all' ? 'All campuses' : data.colleges.find(c => c.id === campus)?.name ?? 'Selected campus';
  const verificationRate = totals.students ? Math.round(totals.verifiedStudents / totals.students * 100) : 0;

  return <div className="admin-analytics-page">
    <header className="admin-analytics-header"><div><span className="analytics-eyebrow">UNICIRQ · CAMPUS INSIGHTS</span><h1>Activity & analytics</h1><p>See how your campus community is growing and where your team’s attention is needed.</p><div className="analytics-scope"><MapPin size={14} /><span>{campusLabel}</span><span>·</span><span>{analytics.rangeLabel}</span></div></div><Link className="analytics-header-action" href="/admin"><ArrowLeft size={15} />Back to dashboard</Link></header>
    <div className="admin-analytics-kpis">
      {[
        { label: 'Listings created', value: totals.listings.toLocaleString('en-IN'), note: analytics.periodLabel, icon: ShoppingBag },
        { label: 'Order requests', value: totals.orders.toLocaleString('en-IN'), note: `${totals.completedOrders} currently completed`, icon: ChartNoAxesCombined },
        { label: 'Requested order value', value: moneyLabel(totals.orderValue), note: 'Excludes cancelled requests', icon: Wallet },
        { label: 'Verified students', value: `${verificationRate}%`, note: `${totals.verifiedStudents} of ${totals.students} students joined`, icon: Users },
      ].map(({ label, value, note, icon: Icon }) => <article className="analytics-kpi" key={label}><span className="metric-icon blue"><Icon size={20} /></span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>)}
    </div>
    <AnalyticsCoverage demo={data.demo} />
    <div className="admin-analytics-grid">
      <AnalyticsCard wide title="Community activity" subtitle={`New members, listings and order requests · ${analytics.bucketLabel}`} icon={ChartNoAxesCombined}>
        <TrendChart title="Community activity" data={analytics.activity} series={activitySeries} />
      </AnalyticsCard>
      <AnalyticsCard id="campuses" title="Campus performance" subtitle="Members, listings and requests created in this period" icon={MapPin}>
        <BarChart title="Campus performance" data={analytics.campuses} series={campusSeries} />
      </AnalyticsCard>
      <AnalyticsCard title="Marketplace mix" subtitle="Listings created in this period · all current statuses" icon={ShoppingBag}>
        <DonutChart title="Marketplace mix" data={analytics.listingMix} centerLabel="listings" />
      </AnalyticsCard>
      <AnalyticsCard title="Requested order value" subtitle="Value by request date · excludes currently cancelled requests" icon={Wallet}>
        <TrendChart title="Requested order value" data={analytics.activity} series={valueSeries} format="currency" />
        <p className="analytics-card-note">Requested amounts are not payments, platform revenue or settled GMV.</p>
      </AnalyticsCard>
      <AnalyticsCard title="Order status" subtitle="Current status of requests created in this period" icon={ChartNoAxesCombined}>
        <DonutChart title="Order status" data={analytics.orderStatus} centerLabel="requests" />
      </AnalyticsCard>
      <AnalyticsCard title="Verification applications" subtitle="Current decisions for applications submitted in this period" icon={ClipboardCheck}>
        <DonutChart title="Verification applications" data={analytics.verificationStatus.map(row => ({ ...row, color: row.label === 'Pending' ? '#f59e0b' : row.label === 'Approved' ? '#059669' : '#ef4444' }))} centerLabel="applications" />
        <Link className="analytics-card-link" href="/admin/verifications">Review {totals.pendingVerifications} pending applications →</Link>
      </AnalyticsCard>
      <AnalyticsCard title="Support & disputes" subtitle="Current resolution status of cases opened in this period" icon={LifeBuoy}>
        <BarChart title="Support & disputes" data={analytics.support} series={supportSeries} />
        <Link className="analytics-card-link" href="/admin/support">Open support workspace · {totals.openTickets} open cases →</Link>
      </AnalyticsCard>
    </div>
  </div>;
}
