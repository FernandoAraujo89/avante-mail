import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Avante Mail",
    template: "%s · Avante Mail",
  },
  description:
    "Plataforma de e-mail marketing da Avante Soluções Digitais para comunicação com parceiros.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
