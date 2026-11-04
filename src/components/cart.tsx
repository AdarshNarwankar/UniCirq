'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Minus, Plus, ShoppingBag, ShoppingCart, Trash2, Store, ShieldCheck } from 'lucide-react';
import { useApp } from './provider';
import { moneyLabel } from '@/lib/domain';
import { ProductImage } from './catalogue';
import { Empty, Heading } from './primitives';
import { readCart, removeFromCart, clearCart, subscribeCart } from '@/lib/cart-store';

export function Cart() {
  const { data } = useApp();
  const [ids, setIds] = useState<string[]>([]);
  const refresh = useCallback(() => setIds(readCart()), []);
  useEffect(() => { refresh(); return subscribeCart(refresh); }, [refresh]);
  const items = useMemo(() => ids.map(id => data.listings.find(listing => listing.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item && item.status === 'active' && ['sale', 'hardware'].includes(item.kind) && item.owner_id !== data.user.id)), [ids, data.listings, data.user.id]);
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  const groups = new Map<string, typeof items>();
  for (const item of items) groups.set(item.owner_id, [...(groups.get(item.owner_id) ?? []), item]);
  const remove = (id: string) => removeFromCart(id);
  return <div className="uc-cart">
    <Link href="/student/buy" className="back-link"><ArrowLeft size={15}/> Continue browsing</Link>
    <Heading eyebrow="YOUR CAMPUS CART" title="A few good finds." subtitle="Review your items before moving to payment." action={<span className="uc-cart-count"><ShoppingCart size={16}/>{items.length} {items.length === 1 ? 'item' : 'items'}</span>} />
    {!items.length ? <Empty title="Your cart is waiting for a good find." body="Add an item for sale or project hardware and it will appear here." action={<Link href="/student/buy" className="button primary"><ShoppingBag size={16}/>Explore the marketplace</Link>}/> : <div className="uc-cart-layout">
      <section className="uc-cart-items" aria-label="Cart items">
        {items.map(item => {
          const seller = data.profiles.find(profile => profile.id === item.owner_id);
          return <article className="uc-cart-item panel" key={item.id}>
            <Link className="uc-cart-image" href={'/student/listings/'+item.id}><ProductImage listing={item}/></Link>
            <div className="uc-cart-item-copy">
              <span className="eyebrow">{item.kind === 'hardware' ? 'PROJECT HARDWARE' : item.category.toUpperCase()}</span>
              <Link href={'/student/listings/'+item.id} className="uc-cart-item-title">{item.title}</Link>
              <span className="uc-cart-seller"><Store size={13}/>{seller?.name ?? 'Campus seller'}</span>
              <strong className="uc-cart-price">{moneyLabel(item.price)}</strong>
            </div>
            <button type="button" className="uc-cart-remove" onClick={() => remove(item.id)} aria-label={'Remove '+item.title+' from cart'}><Trash2 size={17}/><span>Remove</span></button>
          </article>;
        })}
      </section>
      <aside className="uc-cart-summary panel">
        <span className="eyebrow">ORDER SUMMARY</span><h2>Bill summary</h2>
        <div className="uc-cart-summary-lines"><div><span>Items ({items.length})</span><strong>{moneyLabel(subtotal)}</strong></div><div><span>Delivery</span><strong>₹0</strong></div><div className="uc-cart-subtotal"><span>Item subtotal</span><strong>{moneyLabel(subtotal)}</strong></div></div>
        <p className="uc-cart-fee-note">Any applicable platform fee and tax will be calculated and shown before you pay. No payment is taken on this page.</p>
        <button type="button" className="button primary full" disabled title="Payment checkout is being connected to verified UPI billing">Continue to checkout <ArrowRight size={16}/></button>
        <button type="button" className="uc-cart-clear" onClick={() => clearCart()}>Clear cart</button>
        <div className="uc-cart-trust"><ShieldCheck size={17}/><span>You'll see the final payable amount and a fixed-amount UPI QR before submitting payment.</span></div>
        <small className="uc-cart-group-note">{groups.size} {groups.size === 1 ? 'seller' : 'sellers'} in your cart. Bills will be separated by seller at checkout.</small>
      </aside>
    </div>}
  </div>;
}
