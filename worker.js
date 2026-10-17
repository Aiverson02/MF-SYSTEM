// Worker de hosting: encaminha tudo para os assets estáticos (SPA).
// Rotas da API não existem neste projecto — todo o backend é o Supabase.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request)
  },
}
