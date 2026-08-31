'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Overview', icon: 'M3 12l9-9 9 9M5 10v10h14V10' },
  { href: '/cases', label: 'Recovery queue', icon: 'M4 6h16M4 12h16M4 18h10' },
  { href: '/evaluation', label: 'Evaluation', icon: 'M4 19V5m0 14h16M8 15l3-4 3 2 4-6' },
  { href: '/policy', label: 'Policy', icon: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z' },
];

export function Sidebar() {
  const path = usePathname();
  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">R</div>
        <div className="brand-name">RecoverAI</div>
      </div>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={`nav-link ${isActive(l.href) ? 'active' : ''}`}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d={l.icon} />
          </svg>
          {l.label}
        </Link>
      ))}
      <div className="nav-sep" />
      <div className="nav-foot">
        Revenue recovery, bounded by design. AI decides within limits; deterministic code enforces them.
      </div>
    </aside>
  );
}
