/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // BUG (V8 / C9): wildcard hostname allows the Next.js image optimizer to
    // proxy requests to ANY remote host. Plausibly indie-broken: dev wanted
    // user-provided avatar URLs to "just work" without listing every CDN.
    remotePatterns: [
      { protocol: "https", hostname: "**" }
    ]
  }
};

export default nextConfig;
