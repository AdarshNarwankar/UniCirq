import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareListingPhoto } from '../src/lib/listing-photo-processing';
import { listingPhotoIssue, maxListingPhotoBytes, maxStoredPhotoBytes } from '../src/lib/listing-photo';
import { readListingPhotoRequest } from '../src/lib/listing-photo-request';
import { AppError } from '../src/lib/policy';

const command = { type: 'create_listing', title: 'Campus calculator', description: 'Working calculator with its cover.', kind: 'sale', category: 'Electronics', price: 50000, unit: 'item', condition: 'Good', location: 'Main library entrance' };
const image = () => sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#2163ec' } });
const file = (bytes: Uint8Array, type = 'image/png') => new File([new Uint8Array(bytes)], '../../unsafe-name.png', { type });
const errorStatus = (status: number) => (error: unknown) => error instanceof AppError && error.status === status;
function request(fields: FormData) { return new Request('https://unicirq.example/api/listings', { method: 'POST', body: fields }); }

test('photo processing decodes JPG/PNG/WebP, strips metadata and bounds output', async () => {
  const inputs = [
    ['image/jpeg', await image().withMetadata({ orientation: 6 }).jpeg().toBuffer()],
    ['image/png', await image().png().toBuffer()],
    ['image/webp', await image().webp().toBuffer()],
  ] as const;
  for (const [type, bytes] of inputs) {
    const prepared = await prepareListingPhoto(file(bytes, type));
    const metadata = await sharp(prepared.bytes).metadata();
    assert.equal(prepared.content_type, 'image/webp'); assert.equal(metadata.format, 'webp');
    assert.ok(prepared.bytes.length <= maxStoredPhotoBytes);
    assert.ok(metadata.width <= 1600 && metadata.height <= 1600);
    assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
  }
});

test('photo processing rejects empty, unsupported, disguised, corrupt and oversized files', async () => {
  assert.match(listingPhotoIssue({ size: 0, type: 'image/png' })!, /empty/);
  assert.match(listingPhotoIssue({ size: maxListingPhotoBytes + 1, type: 'image/png' })!, /4 MB/);
  assert.match(listingPhotoIssue({ size: 10, type: 'image/svg+xml' })!, /JPG/);
  for (const input of [file(new Uint8Array()), file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')), file(Buffer.from('not a photo')), file(new Uint8Array(maxListingPhotoBytes + 1))]) {
    await assert.rejects(() => prepareListingPhoto(input), errorStatus(400));
  }
  const jpeg = await image().jpeg().toBuffer();
  await assert.rejects(() => prepareListingPhoto(file(jpeg.subarray(0, 40), 'image/jpeg')), errorStatus(400));
});

test('photo decoder rejects excessive dimensions and animated inputs', async () => {
  const enormous = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(() => prepareListingPhoto(file(enormous)), errorStatus(400));
  const frames = Buffer.concat([Buffer.alloc(16 * 16 * 3, 0), Buffer.alloc(16 * 16 * 3, 255)]);
  const animated = await sharp(frames, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  // Animated WebP is rejected even though still WebP is supported.
  await assert.rejects(() => prepareListingPhoto(file(animated, 'image/webp')), errorStatus(400));
});

test('multipart upload accepts one photo and strips untrusted command fields', async () => {
  const form = new FormData();
  form.set('command', JSON.stringify({ ...command, owner_id: 'forged', image: 'https://attacker.example/photo.svg' }));
  form.set('photo', file(await image().png().toBuffer()));
  const parsed = await readListingPhotoRequest(request(form));
  assert.deepEqual(parsed.command, command); assert.ok(parsed.photo.size > 0);
});

test('multipart upload rejects other commands, duplicate files and invalid fields', async () => {
  const photo = file(await image().png().toBuffer());
  for (const kind of ['other-command', 'duplicate', 'missing', 'invalid-json', 'extra-field']) {
    const form = new FormData();
    form.set('command', kind === 'invalid-json' ? '{' : JSON.stringify(kind === 'other-command' ? { type: 'read_notifications' } : command));
    if (kind !== 'missing') form.set('photo', photo);
    if (kind === 'duplicate') form.append('photo', photo);
    if (kind === 'extra-field') form.set('listing_id', 'forged');
    await assert.rejects(() => readListingPhotoRequest(request(form)), errorStatus(400));
  }
});

test('multipart limit rejects declared or streamed oversize bodies before parsing', async () => {
  const headers = { 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': String(maxListingPhotoBytes + 20_001) };
  await assert.rejects(() => readListingPhotoRequest(new Request('https://unicirq.example/api/listings', { method: 'POST', headers, body: 'x' })), errorStatus(413));
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(maxListingPhotoBytes + 20_001)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => readListingPhotoRequest(new Request('https://unicirq.example/api/listings', { method: 'POST', headers: { ...headers, 'Content-Length': '1' }, body: stream, duplex: 'half' } as RequestInit)), errorStatus(413));
  assert.equal(cancelled, true);
});
