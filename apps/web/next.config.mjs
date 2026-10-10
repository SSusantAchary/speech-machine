import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@video/shared"],
  images: {
    remotePatterns: [],
  },
  webpack: (config) => {
    config.resolve.alias["@mediapipe/tasks-vision"] = path.resolve(
      process.cwd(),
      "../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"
    );
    return config;
  },
};

export default nextConfig;
