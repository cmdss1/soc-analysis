/** @type {import('next').NextConfig} */

const nextConfig = {
  output: 'export',
  distDir: '../public',
  env: {
    name: 'SOC Analysis registry',
    description: 'SOC sandbox Chrome + MITM workspace definitions.',
    icon: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    // GitHub Pages site root only — must NOT include /1.1/ or Kasm rejects the registry ("valid schema list").
    listUrl: 'https://cmdss1.github.io/soc-analysis-kasm-registry/',
    contactUrl: 'https://github.com/cmdss1/soc-analysis-kasm-registry/issues',
  },
  reactStrictMode: true,
  basePath: '/soc-analysis-kasm-registry/1.1',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
