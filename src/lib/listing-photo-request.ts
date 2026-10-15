import { AppError } from './policy';
import { commandSchema } from './domain';
import { maxListingPhotoBytes } from './listing-photo';

// Bound streamed multipart requests even when Content-Length is absent or forged.
export async function readListingPhotoRequest(request: Request) {
  const maximum = maxListingPhotoBytes + 20_000;
  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('multipart/form-data;')) throw new AppError('Choose a listing photo to upload.', 400);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new AppError('Choose a photo smaller than 4 MB.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Invalid upload', 400);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new AppError('Choose a photo smaller than 4 MB.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let form: FormData;
  try { form = await new Response(bytes, { headers: { 'Content-Type': type } }).formData(); }
  catch { throw new AppError('This upload could not be read. Choose your photo again.', 400); }
  if (form.getAll('command').length !== 1 || form.getAll('photo').length !== 1 || [...form.keys()].some(key => !['command', 'photo'].includes(key))) {
    throw new AppError('Choose one photo for this listing.', 400);
  }
  const raw = form.get('command'), photo = form.get('photo');
  if (typeof raw !== 'string' || raw.length > 12_000 || !(photo instanceof File)) throw new AppError('Invalid listing upload.', 400);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new AppError('Invalid listing details.', 400); }
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? 'Check your details.', 400);
  if (parsed.data.type !== 'create_listing') throw new AppError('This upload must be for a new listing.', 400);
  return { command: parsed.data, photo };
}
