import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'خزانة الأفكار - Idea Vault',
        short_name: 'خزانة الأفكار',
        description: 'منصة لحفظ أفكار المشاريع ومناقشتها وتحويلها إلى نماذج أولية IoT',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f2f4f1',
        theme_color: '#0f5c4d',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/monaco*', '**/editor.api*', '**/*.ttf'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
      },
    }),
  ],
});
