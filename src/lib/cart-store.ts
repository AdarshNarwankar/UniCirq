'use client';

const STORAGE_KEY = 'unicirq-cart-v1';
const EVENT_NAME = 'unicirq-cart-change';

export function readCart(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];
  } catch { return []; }
}
function writeCart(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}
export function addToCart(id: string) {
  const ids = readCart();
  if (ids.includes(id)) return false;
  writeCart([...ids, id]);
  return true;
}
export function removeFromCart(id: string) { writeCart(readCart().filter(item => item !== id)); }
export function clearCart() { writeCart([]); }
export function subscribeCart(callback: () => void) {
  window.addEventListener(EVENT_NAME, callback);
  window.addEventListener('storage', callback);
  return () => { window.removeEventListener(EVENT_NAME, callback); window.removeEventListener('storage', callback); };
}
