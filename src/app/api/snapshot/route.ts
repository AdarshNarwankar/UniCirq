import { requireApiUser } from '@/lib/server/auth';
import { readSnapshot } from '@/lib/server/repository';
import { json, failure } from '@/lib/server/http';
export async function GET(){try{return json(await readSnapshot(await requireApiUser()))}catch(e){return failure(e)}}
