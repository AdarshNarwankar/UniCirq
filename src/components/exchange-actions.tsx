'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, MessageCircle, ShieldCheck } from 'lucide-react';
import type { Order } from '@/lib/domain';
import { moneyLabel } from '@/lib/domain';
import { conversationHref } from '@/lib/exchange';
import { rentalBoundaryLabel } from '@/lib/rental-pricing';
import { useApp } from './provider';
import { ActionButton, Modal } from './primitives';

export function OrderChat({ order, className = 'button secondary' }: { order: Order; className?: string }) {
  const { run } = useApp();
  const router = useRouter();
  return <ActionButton className={className} onAction={async () => {
    const result = await run({ type: 'start_order_conversation', order_id: order.id });
    if (result.id) router.push(conversationHref(result.id));
  }}><MessageCircle size={16} />Message {order.kind === 'service' ? 'about booking' : 'about exchange'}</ActionButton>;
}

type Transition = 'accepted' | 'handed_over' | 'completed' | 'cancelled';
export function TransitionConfirm({ order, status, onClose }: { order: Order; status: Transition; onClose: () => void }) {
  const { data, run } = useApp();
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const seller = order.seller_id === data.user.id;
  const title = status === 'accepted' ? 'Accept this request?' : status === 'handed_over' ? (order.kind === 'service' ? 'Confirm service delivery?' : 'Confirm you received the item?') : status === 'completed' ? (order.kind === 'rental' ? 'Confirm the inspected return?' : 'Complete this exchange?') : seller && order.status === 'requested' ? 'Decline this request?' : 'Cancel this request?';
  const statement = status === 'accepted' ? 'I have reviewed the request and can provide this item or service.' : status === 'handed_over' ? (order.kind === 'service' ? 'I received the agreed service and checked the delivery.' : 'I inspected the item and have received it from the owner.') : status === 'completed' ? (order.kind === 'rental' ? 'I received the returned item and inspected its condition.' : 'The agreed exchange is finished.') : 'I understand that this request will be cancelled.';
  const label = status === 'accepted' ? 'Accept request' : status === 'handed_over' ? 'Confirm receipt' : status === 'completed' ? (order.kind === 'rental' ? 'Confirm return & complete' : 'Confirm completion') : seller && order.status === 'requested' ? 'Decline request' : 'Cancel request';
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}><form className="exchange-confirm" onSubmit={async e => {
    e.preventDefault();
    if (!checked || busy) return;
    setBusy(true); setError('');
    try { await run({ type: 'transition_order', order_id: order.id, status }, 'Activity updated'); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }}><div className="exchange-review"><strong>{order.terms_snapshot.title}</strong><span>{moneyLabel(order.amount)} · Recorded request amount</span>{((order.starts_at && order.ends_at) || (order.starts_on && order.ends_on)) && <span>{rentalBoundaryLabel(order, 'start')} – {rentalBoundaryLabel(order, 'end')}</span>}</div><p>{status === 'accepted' ? 'Agree on a time and a public campus meeting place in messages.' : status === 'cancelled' ? 'The other participant will be notified. Your previous activity history stays on the record.' : 'This confirmation adds your name and time to the activity history. Check the details before continuing.'}</p><label className="checkbox"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} required disabled={busy} />{statement}</label><div className="exchange-payment-note"><ShieldCheck size={16} /><span>UniCirq records the exchange. Payments are arranged directly between participants.</span></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="exchange-confirm-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Go back</button><button className={`button ${status === 'cancelled' ? 'danger-outline' : 'primary'}`} disabled={busy || !checked}>{busy && <LoaderCircle size={16} className="spin" />}{label}</button></div></form></Modal>;
}
