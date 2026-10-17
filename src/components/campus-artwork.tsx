/** CSS chooses the artwork before hydration, including a saved dark preference. */
export function CampusArtwork({ alt, priority = false }: { alt: string; priority?: boolean }) {
  return <>
    <img src="/images/campus-orbit.webp" alt={alt} width="1440" height="960" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} />
    <img className="uc-dark-art" src="/images/campus-orbit-dark.webp" alt={alt} width="1440" height="960" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} />
  </>;
}
