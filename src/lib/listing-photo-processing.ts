import sharp from 'sharp';
import { AppError } from './policy';
import { listingPhotoIssue, maxStoredPhotoBytes } from './listing-photo';

export interface ListingPhoto { bytes: Buffer; content_type: 'image/webp' }

// Decode and re-encode all uploads. Never persist a supplied name, URL or metadata.
export async function prepareListingPhoto(file: File): Promise<ListingPhoto> {
  const issue = listingPhotoIssue(file);
  if (issue) throw new AppError(issue, 400);
  try {
    const input = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) {
      throw new AppError('Choose a still JPG, PNG or WebP photo.', 400);
    }
    const bytes = await input.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, effort: 3 }).timeout({ seconds: 8 }).toBuffer();
    if (bytes.length > maxStoredPhotoBytes) throw new AppError('This photo is too detailed. Try a smaller photo.', 400);
    return { bytes, content_type: 'image/webp' };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('This photo could not be read. Try another JPG, PNG or WebP photo.', 400);
  }
}
