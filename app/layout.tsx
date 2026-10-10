import "./globals.css";
export const metadata = {
  title: "ApnaDesign — Collaborative design studio",
  description: "A multiplayer browser design editor built with TypeScript.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
