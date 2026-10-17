'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, MessageCircle, Send, ShieldCheck } from 'lucide-react';
import { useApp } from './provider';
import { moneyLabel } from '@/lib/domain';
import { activeOrder, activityHref, kindLabel, statusLabel } from '@/lib/exchange';
import { Heading, Empty, Badge, Verified } from './primitives';

export function Messages({ selectedId }: { selectedId?: string }) {
  const { data, run } = useApp();
  const [selected, setSelected] = useState(selectedId ?? data.conversations[0]?.id), [drafts, setDrafts] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const cv = data.conversations.find(c => c.id === selected);
  const otherId = cv?.member_a === data.user.id ? cv?.member_b : cv?.member_a;
  const other = data.profiles.find(p => p.id === otherId);
  const listing = data.listings.find(l => l.id === cv?.listing_id);
  const request = data.requests.find(r => r.id === cv?.request_id);
  const matchingOrders = data.orders.filter(o => o.listing_id === cv?.listing_id && [o.buyer_id, o.seller_id].includes(data.user.id) && [o.buyer_id, o.seller_id].includes(otherId ?? '')).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const order = matchingOrders.find(activeOrder) ?? matchingOrders[0];
  const messages = data.messages.filter(m => m.conversation_id === selected).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const draft = selected ? drafts[selected] ?? '' : '';
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, selected]);
  const conversations = [...data.conversations].sort((a, b) => {
    const latest = (id: string, created: string) => data.messages.filter(m => m.conversation_id === id).reduce((time, m) => m.created_at > time ? m.created_at : time, created);
    return latest(b.id, b.created_at).localeCompare(latest(a.id, a.created_at));
  });
  return <><Heading eyebrow="YOUR CONVERSATIONS" title="Good things start with a hello." subtitle="Agree on the details and keep your exchange connected." />{conversations.length ? <div className="messaging panel exchange-messaging"><aside className="conversation-list"><div className="conversation-list-heading">Messages <Badge tone="blue">{conversations.length}</Badge></div>{conversations.map(conversation => {
    const person = data.profiles.find(p => p.id === (conversation.member_a === data.user.id ? conversation.member_b : conversation.member_a));
    const last = data.messages.filter(m => m.conversation_id === conversation.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const context = data.listings.find(l => l.id === conversation.listing_id)?.title ?? data.requests.find(r => r.id === conversation.request_id)?.title;
    return <button className={`conversation ${selected === conversation.id ? 'active' : ''}`} key={conversation.id} disabled={busy} aria-pressed={selected === conversation.id} onClick={() => { setSelected(conversation.id); setError(''); }}><span className="avatar">{person?.avatar ?? 'UC'}</span><span><strong>{person?.name ?? 'Campus member'}</strong><small className="conversation-context">{context ?? 'Campus exchange'}</small><small>{last?.body ?? 'Start the conversation'}</small></span></button>;
  })}</aside><section className="chat-pane">{cv ? <><div className="chat-heading"><span className="avatar">{other?.avatar ?? 'UC'}</span><div><strong>{other?.name ?? 'Campus member'}</strong>{other?.verified && <Verified small />}</div>{order && <Link className="text-link" href={activityHref(order.id)}>View activity <ArrowRight size={13} /></Link>}</div><div className="exchange-chat-context"><span className="category-icon"><MessageCircle size={18} /></span><div><small>{listing ? kindLabel[listing.kind] : 'Campus request'}</small><strong>{order?.terms_snapshot.title ?? listing?.title ?? request?.title ?? 'Campus exchange'}</strong><span>{order ? `${moneyLabel(order.amount)} · ${statusLabel(order.status, order.kind)}` : listing ? `${moneyLabel(listing.price)}${listing.unit !== 'item' ? ` / ${listing.unit}` : ''}` : request ? `Budget ${moneyLabel(request.budget)}` : ''}</span></div>{listing && <Link className="text-link" href={`/student/listings/${listing.id}`}>View listing <ArrowRight size={13} /></Link>}{request && <Link className="text-link" href="/student/requests">Request board <ArrowRight size={13} /></Link>}</div><div className="chat-safety"><ShieldCheck size={14} />Meet in a public campus spot. Keep sign-in and banking codes private.</div><div className="message-list" role="log" aria-label="Conversation messages">{messages.map(message => <div className={`message ${message.sender_id === data.user.id ? 'outgoing' : 'incoming'}`} key={message.id}><p>{message.body}</p><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div>)}{!messages.length && <div className="empty-chat">Say hello and agree on the details.</div>}<div ref={bottom} /></div><form className="message-compose" onSubmit={async e => {
    e.preventDefault(); if (!draft.trim() || busy) return;
    const conversationId = cv.id, sentDraft = draft;
    setBusy(true); setError('');
    try { await run({ type: 'send_message', conversation_id: conversationId, body: sentDraft }); setDrafts(previous => ({ ...previous, [conversationId]: previous[conversationId] === sentDraft ? '' : previous[conversationId] })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }}><input aria-label="Message" placeholder="Write a friendly hello…" value={draft} maxLength={2000} disabled={busy || !data.user.verified} onChange={e => setDrafts(previous => ({ ...previous, [cv.id]: e.target.value }))} /><button className="button primary" disabled={busy || !draft.trim() || !data.user.verified} aria-label="Send message"><Send size={18} /></button></form>{error && <p className="form-error" role="alert">{error}</p>}</> : <Empty title="This conversation isn’t available." body="Choose one of your conversations to continue." />}</section></div> : <Empty title="Your next connection is out there." body="Open a listing or request to start a private conversation." action={<Link className="button primary" href="/student/marketplace">Explore listings</Link>} />}</>;
}
