'use client';
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { listingPhotoIssue, listingPhotoTypes } from '@/lib/listing-photo';

export function ListingPhotoPicker({ photo, onChange }: { photo: File | null; onChange: (photo: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    if (!photo) { setPreview(''); return; }
    setPreview('');
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.onerror = () => { setError('This photo could not be previewed. Choose another photo.'); onChange(null); };
    reader.readAsDataURL(photo);
    return () => { reader.onload = null; reader.onerror = null; if (reader.readyState === FileReader.LOADING) reader.abort(); };
  }, [photo, onChange]);
  return <section className="listing-photo-picker" aria-labelledby="listing-photo-title">
    <label id="listing-photo-title" htmlFor="listing-photo">Listing photo <span>(optional)</span></label>
    <p id="listing-photo-help">Add one JPG, PNG or WebP photo, up to 4 MB.</p>
    <div className="listing-photo-control"><ImagePlus size={24} aria-hidden="true" /><input id="listing-photo" ref={input} type="file" accept={listingPhotoTypes.join(',')} aria-describedby={`listing-photo-help${error ? ' listing-photo-error' : ''}`} aria-invalid={Boolean(error)} onChange={event => {
      const file = event.target.files?.[0] ?? null, issue = file ? listingPhotoIssue(file) : null;
      event.target.setCustomValidity(issue ?? ''); setError(issue ?? ''); onChange(issue ? null : file);
    }} /></div>
    {error && <p className="form-error" role="alert" id="listing-photo-error">{error}</p>}
    {photo && <div className="listing-photo-preview">{preview && <img src={preview} alt="Preview of your listing photo" />}<span>{photo.name}</span></div>}
    {(photo || error) && <button type="button" className="text-button listing-photo-remove" onClick={() => { if (input.current) { input.current.value = ''; input.current.setCustomValidity(''); } onChange(null); setError(''); setPreview(''); }}><X size={15} />Remove photo</button>}
  </section>;
}
