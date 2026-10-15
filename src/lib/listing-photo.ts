// Shared client/server limits; the server checks the actual image format too.
export const listingPhotoTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const maxListingPhotoBytes = 4 * 1024 * 1024;
export const maxStoredPhotoBytes = 800 * 1024;
export function listingPhotoIssue(file: { size: number; type: string }): string | null {
  if (!file.size) return 'Choose a photo that is not empty.';
  if (file.size > maxListingPhotoBytes) return 'Choose a photo smaller than 4 MB.';
  if (!(listingPhotoTypes as readonly string[]).includes(file.type)) return 'Choose a JPG, PNG or WebP photo.';
  return null;
}
