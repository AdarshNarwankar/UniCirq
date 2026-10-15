import { requireApiUser } from '@/lib/server/auth';
import { executeWithPhoto } from '@/lib/server/repository';
import { checkOrigin, failure, json, localLimit } from '@/lib/server/http';
import { requireStudent } from '@/lib/policy';
import { prepareListingPhoto } from '@/lib/listing-photo-processing';
import { readListingPhotoRequest } from '@/lib/listing-photo-request';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireApiUser();
    requireStudent(user);
    localLimit(user.id, 30);
    const { command, photo } = await readListingPhotoRequest(request);
    const prepared = await prepareListingPhoto(photo);
    return json(await executeWithPhoto(user, command, prepared));
  } catch (error) { return failure(error); }
}
