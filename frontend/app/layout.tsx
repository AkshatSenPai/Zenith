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

// Applies saved prefs to <html> before first paint so there's no flash: the skin (Arc↔Ghost
// crosses dark↔light) and the reduced-motion flag (so the orb/ambient/scanline boot calm).
// Kept inline + tiny; mirrors SKIN_STORAGE_KEY / DEFAULT_SKIN and lib/prefs REDUCE_MOTION_KEY.
const noFlashPrefs = `(function(){try{var d=document.documentElement;var s=localStorage.getItem('zenith-skin');d.dataset.skin=(s==='ghost'||s==='amethyst'||s==='arc')?s:'arc';if(localStorage.getItem('zenith-reduce-motion')==='1')d.dataset.reduceMotion='true';}catch(e){document.documentElement.dataset.skin='arc';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the no-flash script sets <html data-skin> before hydration, so the
    // server markup (no attribute) intentionally differs from the client — silence that one warning.
    <html lang="en" suppressHydrationWarning className={fontVars}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashPrefs }} />
      </head>
      <body className="font-body antialiased">
        <SkinProvider>{children}</SkinProvider>
      </body>
    </html>
  );
}
