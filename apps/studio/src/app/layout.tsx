import "./globals.css";
export const metadata = { title: "daport studio" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body className="h-full bg-neutral-100 text-neutral-900">{children}</body></html>;
}
