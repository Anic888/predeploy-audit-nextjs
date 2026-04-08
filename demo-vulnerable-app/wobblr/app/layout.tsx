import type { ReactNode } from "react";

export const metadata = {
  title: "Wobblr — Pro Profiles",
  description: "Claim your username. Upgrade to Pro for AI-written bios."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          maxWidth: 720,
          margin: "40px auto",
          padding: "0 20px",
          color: "#222"
        }}
      >
        {children}
      </body>
    </html>
  );
}
