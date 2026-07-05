/** @type {import('next').NextConfig} */
export default {
  // Service worker + manifest are static files in /public; no PWA plugin needed.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};
