'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <div className="empty-state"><h1>We couldn’t load this page.</h1><p>Your connection or campus data may be temporarily unavailable.</p><button className="button primary" onClick={reset}>Try again</button></div>}
