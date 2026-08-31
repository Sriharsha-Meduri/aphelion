/** @type {import('next').NextConfig} */

// The dashboard is a thin client over the API. Requests to /api and /demo are
// proxied to the API service so the browser talks to a single origin. Point
// API_URL at the API in other environments (Docker, deploy).
const apiUrl = process.env.API_URL || 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/demo/:path*', destination: `${apiUrl}/demo/:path*` },
    ];
  },
};

export default nextConfig;
