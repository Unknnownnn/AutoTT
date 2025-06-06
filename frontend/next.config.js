/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
  },
  webpack: (config) => {
    // Enable loading of Python and other files
    config.module.rules.push({
      test: /\.(py|csv)$/,
      type: 'asset/resource',
    });
    return config;
  },
}

module.exports = nextConfig 