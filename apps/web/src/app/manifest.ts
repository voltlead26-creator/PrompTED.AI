import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PrompTED",
    short_name: "PrompTED",
    description:
      "Tell TED what you're trying to achieve and get a polished, editable document.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F1E7",
    theme_color: "#C8442B",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
