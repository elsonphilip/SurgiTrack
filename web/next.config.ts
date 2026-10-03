import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo root has its own package.json (shortcut scripts); pin Turbopack to this app folder.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
