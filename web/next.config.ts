import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@trafik/shared"],
  devIndicators: false,
  allowedDevOrigins: ["192.168.1.42"],
};

export default config;
