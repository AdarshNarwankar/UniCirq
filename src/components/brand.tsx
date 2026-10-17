import Link from 'next/link';

export function Brand({ href = '/', light = false }: { href?: string; light?: boolean }) {
  return <Link className={`uc-brand${light ? ' uc-brand-light' : ''}`} href={href} aria-label="UniCirq home"><span className="uc-mark" aria-hidden="true"><i /><i /></span><span>unicirq<span className="uc-brand-period">.</span></span></Link>;
}
