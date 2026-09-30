import { commandSchema } from '@/lib/domain';
import { requireApiUser } from '@/lib/server/auth';
import { execute } from '@/lib/server/repository';
import { checkOrigin, body, json, failure, localLimit } from '@/lib/server/http';
export async function POST(request:Request){try{checkOrigin(request);const user=await requireApiUser();localLimit(user.id);const parsed=commandSchema.safeParse(await body(request));if(!parsed.success)return json({error:parsed.error.issues[0]?.message??'Check your details'},400);return json(await execute(user,parsed.data))}catch(e){return failure(e)}}
