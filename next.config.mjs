/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.fbcdn.net" },
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "scontent.xx.fbcdn.net" },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
    // The invoice rasterizer. These must stay OUT of the webpack bundle:
    // @napi-rs/canvas is a prebuilt native .node binary, and pdfjs-dist loads
    // its own worker plus the standard_fonts assets by filesystem path at
    // runtime. Bundling either breaks the resolution the raster module relies
    // on. Not related to `output: "standalone"`, which stays disabled.
    serverComponentsExternalPackages: [
      "pdf-to-img",
      "pdfjs-dist",
      "@napi-rs/canvas",
    ],
  },
};

export default nextConfig;
