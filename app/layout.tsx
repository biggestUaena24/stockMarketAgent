import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://cedar-tfsa-research.a2782541671.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Cedar TFSA Research Desk",
    template: "%s · Cedar",
  },
  description:
    "A private Calgary-time TFSA ledger and evidence-backed research desk for manual Wealthsimple decisions.",
  applicationName: "Cedar TFSA Research Desk",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    title: "Cedar TFSA Research Desk",
    description:
      "Portfolio truth, source-linked research, and paper-trial discipline—without automated trading.",
    images: [{ url: "/og.png", width: 1729, height: 910 }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#173d32",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
