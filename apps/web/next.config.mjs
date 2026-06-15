/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@arely/ui-core"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
