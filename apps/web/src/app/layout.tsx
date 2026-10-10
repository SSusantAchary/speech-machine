import "@/styles/globals.css";

export const metadata = {
  title: "Speech-Machine",
  description: "Personal video + speech coaching",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-hero-gradient font-body text-ink">
        {children}
      </body>
    </html>
  );
}
