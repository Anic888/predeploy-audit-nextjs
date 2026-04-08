/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // We accept the SSRF surface here because we run behind an
      // egress firewall that blocks 169.254.169.254 and RFC1918.
      // @predeploy-ignore: behind-egress-firewall
      { protocol: "https", hostname: "**" }
    ]
  }
};
export default nextConfig;
