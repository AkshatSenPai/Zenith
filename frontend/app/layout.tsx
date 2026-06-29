import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SkinProvider } from "../components/SkinProvider";

// Self-hosted at build time (no runtime/Google fetch). IBM Plex is the shared font for every skin
// (v7 redesign): Plex Sans → display+body, Plex Mono → mono, mapped to --font-* in globals.css :root.
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-plex-mono" });
const fontVars = `${plexSans.variable} ${plexMono.variable}`;

export const metadata: Metadata = {
  title: "Zenith — HUD",
  description: "Zenith — personal AI assistant (Milestone 2: HUD + voice)",
};

// Applies the saved skin to <html data-skin> before first paint so there's no color flash
// (Arc↔Ghost crosses dark↔light). Kept inline + tiny; mirrors SKIN_STORAGE_KEY / DEFAULT_SKIN.
const noFlashSkin = `(function(){try{var s=localStorage.getItem('zenith-skin');document.documentElement.dataset.skin=(s==='ghost'||s==='amethyst'||s==='arc')?s:'arc';}catch(e){document.documentElement.dataset.skin='arc';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the no-flash script sets <html data-skin> before hydration, so the
    // server markup (no attribute) intentionally differs from the client — silence that one warning.
    <html lang="en" suppressHydrationWarning className={fontVars}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashSkin }} />
      </head>
      <body className="font-body antialiased">
        <SkinProvider>{children}</SkinProvider>
      </body>
    </html>
  );
}
