import type { Metadata } from "next";
import "./globals.css";
import { SkinProvider } from "../components/SkinProvider";

export const metadata: Metadata = {
  title: "Zenith — HUD",
  description: "Zenith — personal AI assistant (Milestone 2: HUD + voice)",
};

// Applies the saved skin to <html data-skin> before first paint so there's no color flash
// (Arc↔Ghost crosses dark↔light). Kept inline + tiny; mirrors SKIN_STORAGE_KEY / DEFAULT_SKIN.
const noFlashSkin = `(function(){try{var s=localStorage.getItem('zenith-skin');document.documentElement.dataset.skin=(s==='ghost'||s==='amethyst'||s==='arc')?s:'arc';}catch(e){document.documentElement.dataset.skin='arc';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashSkin }} />
      </head>
      <body className="font-body antialiased">
        <SkinProvider>{children}</SkinProvider>
      </body>
    </html>
  );
}
