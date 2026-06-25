import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SkinProvider } from "../components/SkinProvider";

// Self-hosted at build time (no runtime/Google fetch). Exposed as CSS vars; the Arc skin opts in
// via globals.css ([data-skin="arc"] maps --font-display/body/mono to these). Other skins keep
// system fonts, so they're unaffected.
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-space-grotesk" });
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-jetbrains-mono" });
const fontVars = `${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`;

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
