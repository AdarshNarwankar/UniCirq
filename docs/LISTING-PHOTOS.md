# Listing photos

Each new listing can include one optional JPG, PNG or WebP photo, up to 4 MiB. The photo picker previews it locally and supports replacing or removing it before publishing. Publishing without a photo keeps the category thumbnail.

Photo listings use `POST /api/listings` with multipart fields `command` and `photo`. The route requires the configured same origin and an authenticated, active, campus-verified Student before it consumes or decodes image bytes. A bounded stream caps the entire request even without a trustworthy Content-Length. The ordinary JSON command endpoint retains its 12 KB limit and cannot accept image URLs or bytes.

Sharp validates the actual format, rejects animation and images above 40 million pixels, auto-orients, resizes within 1600 × 1600, strips metadata and re-encodes WebP. Only output up to 800 KiB is saved. No supplied file name, external URL, EXIF, GPS or source metadata is stored. Invalid files leave the form available for correction.

Migration `008_listing_photos.sql` adds a separate `listing_photos` table and the protected `app_create_listing_with_photo(jsonb,bytea)` function. The function creates the listing, stores the canonical photo and sets the relative image URL in one transaction. It enforces a rolling limit of 20 photo listings per account per day. Dashboard snapshots contain only the image URL, never the bytes. There are no runtime table write grants.

`GET /api/listings/[id]/image` requires a session and selected campus. RLS inherits visibility from the linked listing, including campus, owner, moderation state, Admin and existing exchange access. Responses use a fixed WebP content type, `nosniff`, same-origin resource policy and private/no-store caching. Unavailable and nonexistent photos return the same 404.

The MVP uses the existing Neon database and requires no new environment variables or storage credentials. The repository methods isolate media persistence so it can later move to private object storage as usage grows. Apply the SQL migration with the separate operator connection before deploying the code; never expose the operator URL to hosted runtime.
