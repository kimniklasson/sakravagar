import type { NextConfig } from "next";

const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
  "https://va.vercel-scripts.com",
];

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src ${scriptSrc.join(" ")}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://tiles.openfreemap.org",
      "font-src 'self' data: https://tiles.openfreemap.org",
      "connect-src 'self' https://tiles.openfreemap.org https://nominatim.openstreetmap.org https://router.project-osrm.org https://*.supabase.co https://routing.sakravagar.se https://routing.xn--skravgar-0zae.se",
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@trafik/shared"],
  devIndicators: false,
  allowedDevOrigins: ["192.168.1.42"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.sakravagar.se" }],
        destination: "https://sakravagar.se/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "xn--skravgar-0zae.se" }],
        destination: "https://sakravagar.se/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.xn--skravgar-0zae.se" }],
        destination: "https://sakravagar.se/:path*",
        permanent: true,
      },
    ];
  },
};

export default config;
