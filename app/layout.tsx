import "./globals.css";

export const metadata = { title: "Fila de Impressão 3D" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
