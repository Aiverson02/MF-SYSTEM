import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'SIGA — Gestão de Inscrições',
        short_name: 'SIGA',
        description: 'Painel da secretaria e portal dos formadores.',
        lang: 'pt',
        // '/' encaminha por papel: painel (secretaria/admin) ou portal (formador),
        // para o mesmo PWA instalado servir os dois tipos de utilizador.
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#faf9f7',
        theme_color: '#1a1a1a',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + navegação offline. O cache dos DADOS (REST + RPCs) é
        // gerido pela camada em src/lib/offline.ts, que também cacheia RPCs
        // POST e encaminha as escritas para a fila de sincronização — daí
        // não haver regra Workbox para /rest/v1/.
        navigateFallback: '/index.html',
        // Actualização imediata em produção: o novo SW assume o controlo e
        // limpa os caches antigos sem esperar que o utilizador feche os separadores
        // (sem isto, um deploy novo pode demorar horas a chegar aos telemóveis).
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // Logótipo e pré-visualizações de documentos (GET)
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'siga-storage',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Tipografia offline (Google Fonts)
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'siga-fontes-css',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'siga-fontes-ficheiros',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: false,
  },
})
