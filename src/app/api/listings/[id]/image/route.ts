import { z } from 'zod';
import { requireApiUser } from '@/lib/server/auth';
import { readListingPhoto } from '@/lib/server/repository';
import { failure, json } from '@/lib/server/http';

export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return json({ error: 'Photo not found.' }, 404);
    // RLS applies the linked listing's campus, status, owner and participant rules.
    const photo = await readListingPhoto(user, id);
    if (!photo) return json({ error: 'Photo not found.' }, 404);
    return new Response(new Uint8Array(photo.bytes), { headers: {
      'Content-Type': 'image/webp', 'Content-Length': String(photo.bytes.length),
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
    } });
  } catch (error) { return failure(error); }
}
