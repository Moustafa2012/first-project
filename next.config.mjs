// After a server action that redirects, Next fetches the target page from its own origin. Behind the host's reverse proxy
// the Host / protocol it derives can be unreachable from inside, which logged "failed to get redirect response" and
// delayed the redirect. Point it at the public site URL when one is configured.
if (!process.env.__NEXT_PRIVATE_ORIGIN && process.env.NEXT_PUBLIC_SITE_URL) {
  process.env.__NEXT_PRIVATE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
}

// Content-Security-Policy for pages. Next.js streams its payload in inline <script> tags, so scripts need
// 'unsafe-inline' (no nonces without forcing every page to render dynamically); everything else is same-origin
// except Google Fonts. Files served by the API (PDF, images) are excluded: Chromium's PDF viewer is an <embed> that
// object-src 'none' would block.
const supabase = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin; } catch { return ""; } })();
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self'${supabase ? ` ${supabase} ${supabase.replace(/^http/, "ws")}` : ""}`,
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

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
      // pages only: not API responses nor the shared-file routes that stream PDFs and images
      { source: "/:path((?!api/|s/[^/]+/doc/|s/[^/]+/pdf).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
      // shared medical files: never cached, never indexed, never leak the link through the Referer header
      { source: "/s/:path*", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ] },
      // the public emergency card: same rules as a shared file
      { source: "/e/:path*", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ] },
    ];
  },
};

export default nextConfig;
