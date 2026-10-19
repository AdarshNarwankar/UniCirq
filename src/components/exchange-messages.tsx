'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MessageCircle, Send, ShieldCheck } from 'lucide-react';
import { useApp } from './provider';
import { moneyLabel } from '@/lib/domain';
import { activeOrder, activityHref, kindLabel, statusLabel } from '@/lib/exchange';
import { Heading, Empty, Badge, Verified } from './primitives';

export function Messages({ selectedId }: { selectedId?: string }) {
  const { data, run } = useApp();
  const [selected, setSelected] = useState(selectedId ?? data.conversations[0]?.id), [drafts, setDrafts] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [mobileChatOpen, setMobileChatOpen] = useState(Boolean(selectedId));
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
  return <section className="student-inbox"><Heading eyebrow="YOUR CONVERSATIONS" title="Good things start with a hello." subtitle="Agree on the details and keep your exchange connected." />{conversations.length ? <div className={`messaging exchange-messaging ${mobileChatOpen ? 'mobile-chat-open' : ''}`}><aside className="conversation-list" aria-label="Your inbox"><div className="conversation-list-heading"><div><h2>Inbox</h2><p>Your campus conversations</p></div><Badge tone="blue">{conversations.length}</Badge></div><div className="conversation-scroll">{conversations.map(conversation => {
    const person = data.profiles.find(p => p.id === (conversation.member_a === data.user.id ? conversation.member_b : conversation.member_a));
    const last = data.messages.filter(m => m.conversation_id === conversation.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const context = data.listings.find(l => l.id === conversation.listing_id)?.title ?? data.requests.find(r => r.id === conversation.request_id)?.title;
    return <button className={`conversation ${selected === conversation.id ? 'active' : ''}`} key={conversation.id} disabled={busy} aria-pressed={selected === conversation.id} onClick={() => { setSelected(conversation.id); setMobileChatOpen(true); setError(''); }}><span className="avatar">{person?.avatar ?? 'UC'}</span><span className="conversation-summary"><span className="conversation-topline"><strong>{person?.name ?? 'Campus member'}</strong><time dateTime={last?.created_at ?? conversation.created_at}>{new Date(last?.created_at ?? conversation.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</time></span><small className="conversation-context">{context ?? 'Campus exchange'}</small><small className="conversation-preview">{last?.body ?? 'Start the conversation'}</small></span><ArrowRight className="conversation-arrow" size={15}/></button>;
  })}</div></aside><section className="chat-pane" aria-label="Active conversation">{cv ? <><div className="chat-heading"><button className="icon-button inbox-back" type="button" aria-label="Back to inbox" onClick={() => setMobileChatOpen(false)}><ArrowLeft size={19}/></button><span className="avatar">{other?.avatar ?? 'UC'}</span><div className="chat-person"><strong>{other?.name ?? 'Campus member'}</strong>{other?.verified ? <Verified small /> : <small>Campus member</small>}</div>{order && <Link className="text-link chat-activity-link" href={activityHref(order.id)}>Activity <ArrowRight size={13} /></Link>}</div><div className="exchange-chat-context"><span className="category-icon"><MessageCircle size={18} /></span><div><small>{listing ? kindLabel[listing.kind] : 'Campus request'}</small><strong>{order?.terms_snapshot.title ?? listing?.title ?? request?.title ?? 'Campus exchange'}</strong><span>{order ? `${moneyLabel(order.amount)} · ${statusLabel(order.status, order.kind)}` : listing ? `${moneyLabel(listing.price)}${listing.unit !== 'item' ? ` / ${listing.unit}` : ''}` : request ? `Budget ${moneyLabel(request.budget)}` : ''}</span></div>{listing && <Link className="text-link" href={`/student/listings/${listing.id}`}>View listing <ArrowRight size={13} /></Link>}{request && <Link className="text-link" href="/student/requests">Request board <ArrowRight size={13} /></Link>}</div><div className="chat-safety"><ShieldCheck size={14} /><span>Meet on campus. Keep sign-in and banking codes private.</span></div><div className="message-list" role="log" aria-label="Conversation messages">{messages.map(message => <div className={`message ${message.sender_id === data.user.id ? 'outgoing' : 'incoming'}`} key={message.id}><p>{message.body}</p><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div>)}{!messages.length && <div className="empty-chat"><MessageCircle size={27}/><strong>Start with a hello.</strong><span>Ask a question or agree on the details here.</span></div>}<div ref={bottom} /></div><form className="message-compose" onSubmit={async e => {
    e.preventDefault(); if (!draft.trim() || busy) return;
    const conversationId = cv.id, sentDraft = draft;
    setBusy(true); setError('');
    try { await run({ type: 'send_message', conversation_id: conversationId, body: sentDraft }); setDrafts(previous => ({ ...previous, [conversationId]: previous[conversationId] === sentDraft ? '' : previous[conversationId] })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }}><input aria-label="Message" placeholder="Write a message…" value={draft} maxLength={2000} disabled={busy || !data.user.verified} onChange={e => setDrafts(previous => ({ ...previous, [cv.id]: e.target.value }))} /><button type="submit" className="button primary" disabled={busy || !draft.trim() || !data.user.verified} aria-label="Send message"><Send size={18} /></button></form>{!data.user.verified && <p className="inbox-verification-note">Verify your campus to send messages. <Link className="text-link" href="/student/profile">Go to verification</Link></p>}{error && <p className="form-error" role="alert">{error}</p>}</> : <><button className="button secondary inbox-back" type="button" onClick={() => setMobileChatOpen(false)}><ArrowLeft size={17}/>Back to inbox</button><Empty title="This conversation isn’t available." body="Choose one of your conversations to continue." /></>}</section></div> : <Empty title="Your next connection is out there." body="Open a listing or request to start a private conversation." action={<Link className="button primary" href="/student/marketplace">Explore listings</Link>} />}</section>;
}
