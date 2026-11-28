import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Dois sites, duas entradas, um código:
//   · `npm run build`      → sistema central (painel + portal), src/main.tsx → dist/
//   · `npm run build:site` → página pública, src/main-landing.tsx → dist-landing/
//
// O site público tem entrada própria (`main-landing.tsx`) para que o build do
// domínio público não inclua um único chunk do sistema central (Alunos,
// Finanças, Dashboard, portal dos formadores).
//
// As credenciais do Supabase (`.env`) são as mesmas nos dois: o site público
// fala com a mesma base de dados e é lá que as inscrições ficam guardadas.
export default defineConfig(({ mode }) => {
  const sitePublico = mode === 'landing'

  return {
    build: {
      outDir: sitePublico ? 'dist-landing' : 'dist',
    },
    plugins: [
      react(),
      {
        name: 'html-por-modo',
        // `order: 'pre'`: a entrada do build é lida do HTML depois destes hooks.
        // Sem isto, o site público acabaria a construir o main.tsx do sistema.
        transformIndexHtml: {
          order: 'pre',
          handler(html: string) {
            // Site público: liga o HTML à entrada da landing em vez do painel.
            if (sitePublico) return html.replace('/src/main.tsx', '/src/main-landing.tsx')
            // O index.html é o do site público (título e descrição para o anúncio);
            // no sistema o separador do browser mostra o nome da ferramenta.
            return html.replace(/<title>[\s\S]*?<\/title>/, '<title>SIGA — Painel da Secretaria</title>')
          },
        },
      },
      // O service worker (offline e PWA instalável) é só do sistema: a página
      // pública não guarda dados e deve abrir sempre a versão nova.
      ...(sitePublico
        ? []
        : [
            VitePWA({
              registerType: 'autoUpdate',
              // O registo é feito em src/pwa.ts, que além de registar procura
              // actualizações e recarrega a página quando sai uma versão nova.
              injectRegister: null,
              includeAssets: ['apple-touch-icon.png'],
              manifest: {
                name: 'SIGA — Gestão de Inscrições',
                short_name: 'SIGA',
                description: 'Painel da secretaria e portal dos formadores.',
                lang: 'pt',
                // A app instalada é a ferramenta da secretaria, por isso abre
                // no painel (o portal dos formadores é encaminhado por papel a
                // partir de `casaDoPapel`).
                start_url: '/admin/dashboard',
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
                  // O Google Fonts (CSS e ficheiros) FICA FORA do service worker. Duas
                  // razões: o CSS é pedido em `no-cors` e a resposta opaca que o Workbox
                  // guardaria não tem `Content-Type` (o browser recusa-a e a página cai
                  // para a tipografia do sistema); e o `fetch()` que o worker faz pelos
                  // ficheiros é avaliado contra o `connect-src` da CSP do documento, que
                  // não inclui `fonts.gstatic.com`. O cache HTTP do browser trata das
                  // fontes (são imutáveis, com um ano de validade).
                ],
              },
            }),
          ]),
    ],
    server: {
      port: 5173,
      strictPort: false,
    },
  }
})
