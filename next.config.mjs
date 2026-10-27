/** @type {import('next').NextConfig} */
const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "2mb" }, serverComponentsExternalPackages: ["pdfkit", "fontkit", "bidi-js"] },
  // Some static hosts (e.g. shared Node.js hosting) do not decode %5B/%5D in URLs, so browser chunks named after
  // dynamic routes such as app/.../[pid]/page-<hash>.js answered 404 and the page crashed. Emit them without brackets.
  webpack(config, { isServer, dev }) {
    if (!isServer && !dev) {
      const safe = (name) => String(name).replace(/[\[\]]/g, "_");
      config.output.filename = (pathData) => {
        const name = pathData.chunk && pathData.chunk.name;
        return name ? `static/chunks/${safe(name)}-[chunkhash].js` : "static/chunks/[name]-[chunkhash].js";
      };
      config.output.chunkFilename = (pathData) => {
        const name = pathData.chunk && pathData.chunk.name;
        return name ? `static/chunks/${safe(name)}.[contenthash].js` : "static/chunks/[name].[contenthash].js";
      };
    }
    return config;
  },
  async headers() {
    return [
      { source: "/:path*", headers: [...security, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] },
      // shared medical files: never cached, never indexed, never leak the link through the Referer header
      { source: "/s/:path*", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ] },
    ];
  },
};

export default nextConfig;
