import type { Metadata, Viewport } from "next";
import { dmSans } from "@/design-system/fonts";
import { Providers } from "@/components/providers";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2B2521" },
    { media: "(prefers-color-scheme: dark)", color: "#100E0C" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://ted.littlemissscarlett.co"),
  title: "PrompTED — Thought Enhanced Documents",
  description:
    "PrompTED turns what you're trying to achieve into a finished document, plan, or checklist with TED — Thought Enhanced Documents.",
  applicationName: "PrompTED",
  keywords: ["AI documents", "resume builder", "cover letter", "AI writing", "PrompTED"],
  authors: [{ name: "TED AI" }],
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.svg", sizes: "180x180" }],
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "PrompTED",
    title: "PrompTED — Thought Enhanced Documents",
    description: "AI for the rest of us. Turn any goal into a finished document.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "PrompTED" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PrompTED",
    description: "AI for the rest of us.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("theme");var p=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var t=s==="light"||s==="dark"?s:p;document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.setAttribute("data-theme","light");document.documentElement.style.colorScheme="light";}try{var z=localStorage.getItem("textSize");document.documentElement.setAttribute("data-text-size",z==="large"||z==="larger"?z:"normal");}catch(e){document.documentElement.setAttribute("data-text-size","normal");}})();`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
