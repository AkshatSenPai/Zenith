import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zenith — HUD",
  description: "Zenith — personal AI assistant (Milestone 2: HUD + voice)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body antialiased">{children}</body>
    </html>
  );
}
