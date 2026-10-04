import type { Metadata, Viewport } from "next";
import { DM_Mono, Sora } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { WalletDialog } from "@/components/wallet/WalletDialog";
import { SITE } from "@/config/site";
import "./globals.css";

const body = Sora({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-body" });
const code = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-code" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} · ${SITE.hook}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
};

export const viewport: Viewport = { themeColor: "#5b2bd9" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${body.variable} ${code.variable}`}>
      <body>
        <div className="bg" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <SiteHeader />
        <main className="wrap">{children}</main>
        <SiteFooter />
        <WalletDialog />
      </body>
    </html>
  );
}
