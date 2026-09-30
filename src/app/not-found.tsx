import Link from 'next/link';
export default function NotFound(){return <div className="empty-state"><h1>This page is outside the circle.</h1><p>The link may have changed. Head back to your campus.</p><Link className="button primary" href="/">Back to UniCirq</Link></div>}
