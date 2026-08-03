import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Campanhas Avante",
    template: "%s · Campanhas Avante",
  },
  description:
    "A plataforma de campanhas de e-mail e WhatsApp da Avante Soluções Digitais.",
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
