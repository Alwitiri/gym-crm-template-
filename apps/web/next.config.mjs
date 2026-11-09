/** @type {import('next').NextConfig} */
const API = process.env.API_ORIGIN ?? "http://localhost:4000";
export default {
  reactStrictMode: true,
  output: "standalone", // small self-contained server for Docker (deploy/Dockerfile.web)
  poweredByHeader: false,
  // Same-origin proxy: the session cookie stays first-party and CORS isn't needed in the browser.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API}/api/v1/:path*` }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
      ],
    }];
  },
};
