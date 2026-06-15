/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@arelyos/ui-core"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
