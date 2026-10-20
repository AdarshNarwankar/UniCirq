import type { Listing, Profile } from './domain';

type CampusMember = Pick<Profile, 'id' | 'college_id'>;

export function buyListings(listings: Listing[], member: CampusMember): Listing[] {
  return listings.filter(listing => listing.college_id === member.college_id && listing.kind === 'sale' && listing.status === 'active');
}

export function sellListings(listings: Listing[], member: CampusMember): Listing[] {
  return listings.filter(listing => listing.college_id === member.college_id && listing.kind === 'sale' && listing.owner_id === member.id);
}
