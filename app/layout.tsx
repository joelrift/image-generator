import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RIFT Render Studio',
  description:
    'Turn sketches and Archicad 3D exports into photorealistic visualisations — with the geometry preserved.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
