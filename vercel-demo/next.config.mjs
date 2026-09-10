import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Pin the workspace root to this project: a stray package-lock.json in an
  // unrelated ancestor directory otherwise makes Turbopack guess wrong.
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
