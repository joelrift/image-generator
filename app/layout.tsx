import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RIFT Render Studio',
  description:
    'Gjør skisser og 3D-eksport fra Archicad til fotorealistiske visualiseringer — med bevart geometri.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang="nb" (bokmål) — the more precise tag, and consistent across the app.
  return (
    <html lang="nb">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
