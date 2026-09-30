import { getAuth } from '@/lib/server/better-auth';
import { authConfigured, demoEnabled } from '@/lib/server/config';
import { json } from '@/lib/server/http';
async function handler(request:Request){if(!authConfigured()||demoEnabled())return json({error:'Email sign-in is not configured.'},503);return getAuth().handler(request)}
export { handler as GET, handler as POST };
