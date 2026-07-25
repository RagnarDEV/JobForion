// src/assets/manifest.js
export function manifestJson(base) {
  return JSON.stringify({
    name: "JobForion — Remote Jobs",
    short_name: "JobForion",
    description: "Curated remote job board updated hourly.",
    start_url: "/",
    display: "standalone",
    background_color: "#F6F7FB",
    theme_color: "#3556FF",
    icons: [
      { src: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
    ]
  });
}
