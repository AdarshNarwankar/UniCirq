import { AppError } from './policy';

/** Enforce the byte limit before decoding or parsing an untrusted request. */
type BodySource = { body: ReadableStream<Uint8Array> | null; headers: Headers };
export async function readBoundedText(source: BodySource, maximum = 12_000): Promise<string> {
  const length = source.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maximum) {
    await source.body?.cancel();
    throw new AppError('Request is too large', 413);
  }
  const reader = source.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new AppError('Request is too large', 413);
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new AppError('Use valid UTF-8 text', 400); }
}

export async function readBoundedJson(source: BodySource, maximum = 12_000): Promise<unknown> {
  const raw = await readBoundedText(source, maximum);
  try { return JSON.parse(raw); }
  catch { throw new AppError('Invalid request', 400); }
}
