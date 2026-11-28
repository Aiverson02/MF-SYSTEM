// Worker de hosting: encaminha tudo para os assets estáticos (SPA).
// Rotas da API não existem neste projecto — todo o backend é o Supabase.
//
// Cabeçalhos de segurança aplicados a todas as respostas. A política de
// conteúdo fecha o que o site não precisa: sem scripts de terceiros, sem
// iframes, e as ligações de rede limitadas ao próprio site e ao Supabase.
const CABECALHOS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // O beacon do Cloudflare é injetado pela plataforma no HTML; é o único
    // script de terceiros autorizado.
    "script-src 'self' https://static.cloudflareinsights.com",
    // `fonts.gstatic.com` no `connect-src`: um service worker antigo que ainda
    // intercepte as fontes faz um `fetch()` sujeito a esta directiva.
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cloudflareinsights.com https://fonts.gstatic.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; '),
}

export default {
  async fetch(request, env) {
    const resposta = await env.ASSETS.fetch(request)

    // 304/204 não têm corpo: devolve-se como veio.
    if (resposta.status === 304 || resposta.status === 204) return resposta

    const cabecalhos = new Headers(resposta.headers)
    for (const [nome, valor] of Object.entries(CABECALHOS)) cabecalhos.set(nome, valor)

    return new Response(resposta.body, {
      status: resposta.status,
      statusText: resposta.statusText,
      headers: cabecalhos,
    })
  },
}
