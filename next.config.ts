import type { NextConfig } from "next";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const basePath = process.env.GITHUB_ACTIONS === "true" ? `/${repoName}` : "";

const nextConfig: NextConfig = {
  output: "export",
  // GitHub Pages serves directories, so emit team/index.html rather than
  // team.html; without this, direct hits on /team/ return 404.
  trailingSlash: true,
  basePath,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
