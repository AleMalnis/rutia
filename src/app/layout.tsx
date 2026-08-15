import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Lora, Nunito } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fuentes de la apariencia personalizable (spec §4), autoalojadas en build:
// el navegador nunca llama a Google Fonts.
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RutIA",
  description: "Tu semana, organizada conversando.",
  // PWA (spec §4): instalada en iOS se abre a pantalla completa con su nombre;
  // el manifest lo enlaza Next solo (src/app/manifest.ts) y el icono de iOS
  // sale de la convención src/app/apple-icon.png
  appleWebApp: {
    capable: true,
    title: "RutIA",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // el color de la barra del navegador/estado sigue al modo del sistema; el
  // theme_color del manifest no admite media queries, por eso este sí y aquel no
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} ${nunito.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
