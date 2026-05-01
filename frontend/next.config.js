/** @type {import('next').NextConfig} */
const apiUpstream =
  process.env.API_UPSTREAM?.replace(/\/$/, "") || "http://127.0.0.1:8000";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/soc-api/:path*",
        destination: `${apiUpstream}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        // Required for `<iframe credentialless>` so Kasm cookies are NOT
        // sent inside the embedded workspace — only the JWT in the URL.
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
