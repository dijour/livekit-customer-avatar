import "@livekit/components-styles";
import { Metadata } from "next";
import "./globals.css";
import { amazonEmberDisplay } from './fonts';

export const metadata: Metadata = {
  title: "Voice Assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full ${amazonEmberDisplay.variable}`}>
      <body className={`h-full ${amazonEmberDisplay.className}`}>{children}</body>
    </html>
  );
}
