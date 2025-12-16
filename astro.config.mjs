// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // Astro removed `output: "hybrid"`; `output: "static"` now supports the same
  // behavior when using an adapter + `export const prerender = false` per route.
  output: 'static',
  site: 'https://indianluxurycars.com/',

  vite: {
    plugins: [tailwindcss()],
  },

  adapter: cloudflare(),
});
