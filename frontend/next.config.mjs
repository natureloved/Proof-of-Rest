/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // pino-pretty is an optional dev dependency of pino (via @walletconnect).
    // It is never used in the browser bundle; alias it to false to satisfy Next.
    config.resolve = config.resolve || {};
    // `encoding` is an optional dep of node-fetch (via @metamask/sdk) and is
    // never reached in the browser bundle — alias it away like pino-pretty.
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "pino-pretty": false,
      encoding: false,
    };
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      "pino-pretty": false,
      encoding: false,
    };
    return config;
  },
};

export default nextConfig;
