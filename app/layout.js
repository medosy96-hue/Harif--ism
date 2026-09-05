import './globals.css';

export const metadata = {
  title: 'حرف اسم',
  description: 'تحدّي الحروف السريع — لعبة جماعية أونلاين حتى 20 لاعبًا',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@400;500;700;900&family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
