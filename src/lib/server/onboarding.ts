import 'server-only';
import { withUser } from './db';
import { demoEnabled } from './config';
import { demoState } from '../demo';
import type { Profile, UniversityOption } from '../domain';
import { requireRole } from '../policy';

// The curated colleges table is the supported pilot catalog; no arbitrary names
// or external directories create campus memberships.
export async function readUniversityOptions(actor: Profile): Promise<UniversityOption[]> {
 requireRole(actor,'student');
 if(demoEnabled())return demoState().colleges.map(({id,name,short_name,city})=>({id,name,short_name,city}))
  .sort((a,b)=>a.name.localeCompare(b.name)||a.city.localeCompare(b.city));
 return withUser(actor.id,async db=>{
  const result=await db.query<UniversityOption>('SELECT id,name,short_name,city FROM colleges ORDER BY name,city,id');
  return result.rows;
 });
}
