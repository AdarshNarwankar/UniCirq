import type { Order, OrderStatus } from './domain';

export const activityHref = (id: string) => `/student/activity?order=${id}`;
export const conversationHref = (id: string) => `/student/messages?conversation=${id}`;
export const kindLabel = { sale: 'Buy & sell', rental: 'Rental', hardware: 'Project hardware', service: 'Student service' };
export const activeOrder = (order: Order) => !['completed', 'cancelled'].includes(order.status);
export function statusLabel(status: OrderStatus, kind?: Order['kind']) {
  if (status === 'handed_over') return kind === 'service' ? 'Delivery confirmed' : 'Handover confirmed';
  return { requested: 'Awaiting owner', accepted: 'Accepted', completed: 'Completed', cancelled: 'Cancelled', disputed: 'In dispute' }[status];
}
export function nextStep(order: Order, userId: string) {
  const owner = order.seller_id === userId;
  switch (order.status) {
    case 'requested': return owner ? 'Review the request and agree on the details before accepting.' : 'The owner is reviewing your request. Use messages to agree on the details.';
    case 'accepted': return owner ? (order.kind === 'service' ? 'Arrange delivery with the student. They will confirm receiving the work.' : 'Agree on a campus pickup. The requester confirms after inspecting and receiving the item.') : (order.kind === 'service' ? 'Confirm delivery only after you receive the agreed service.' : 'Meet the owner, inspect the item, then confirm you have received it.');
    case 'handed_over': return order.kind === 'rental' ? (owner ? 'Inspect the returned item, then confirm the return to complete this rental.' : 'Return the item by the agreed date. The owner will inspect it and confirm the return.') : (owner ? 'The requester has confirmed delivery. They will mark the exchange complete.' : 'Once the agreed exchange is finished, confirm completion.');
    case 'completed': return order.kind === 'rental' ? 'The owner confirmed the return. Your rental record is complete.' : 'The requester confirmed completion. Your exchange record is complete.';
    case 'cancelled': return 'This request was cancelled. No further confirmation is needed.';
    case 'disputed': return 'Participant actions are paused. Campus support will review the case.';
  }
}
export function dateLabel(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function eventLabel(status: OrderStatus, kind: Order['kind']) {
  if (status === 'requested') return 'Request sent';
  if (status === 'accepted') return 'Request accepted';
  if (status === 'handed_over') return kind === 'service' ? 'Service delivery confirmed' : 'Item received and handover confirmed';
  if (status === 'completed') return kind === 'rental' ? 'Return inspected and rental completed' : 'Exchange completed';
  if (status === 'cancelled') return 'Request cancelled';
  return 'Dispute opened';
}
