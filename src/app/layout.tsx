import type { Metadata } from 'next';
import { VT323 } from 'next/font/google';
import './globals.css';

const pixelFont = VT323({ 
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
});

export const metadata: Metadata = {
  title: 'SafeFlow - Programmable Payments',
  description: 'Cross-chain streaming vault',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={pixelFont.className}>{children}</body>
    </html>
  );
}
