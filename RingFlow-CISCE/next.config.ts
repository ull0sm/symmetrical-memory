import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_OFFLINE_MODE:
      process.env.NEXT_PUBLIC_OFFLINE_MODE ||
      process.env.OFFLINE_MODE ||
      process.env.offline_mode ||
      "",
  },
  // In development Next blocks requests to /_next/* that carry an Origin from a
  // host it does not recognise. Opening the app on a LAN or Tailscale address
  // then fails to load its dev assets, so the page never hydrates and buttons
  // (including the admin login) do nothing. List every host you load the app
  // from. Add your own with `hostname -I` / your Tailscale IP.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "*.local",
    "192.168.*.*",
    "10.*.*.*",
    "172.*.*.*",
    "100.*.*.*",
  ],
  experimental: {
    serverActions: {
      // Category PDFs upload one per request, up to 8 MB each.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
