import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: undefined, // ensure it's not set to 'export' or 'standalone' without Socket.IO support
};

export default nextConfig;
