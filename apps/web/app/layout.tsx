import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from './components/Sidebar';

export const metadata: Metadata = {
  title: 'RecoverAI',
  description: 'AI-assisted revenue recovery operations',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Sidebar />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
