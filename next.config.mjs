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
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
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
