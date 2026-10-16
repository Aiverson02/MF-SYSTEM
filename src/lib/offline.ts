import { supabase } from './supabase'
import { pushToast } from '../components/ToastHost'

/**
 * Camada offline-first do SIGA.
 *
 * Intercepta o fetch ao Supabase (apenas /rest/v1/):
 *
 *  - LEITURAS (GET e RPCs de consulta): rede primeiro; sem rede serve a última
 *    resposta guardada no Cache API (chave = URL + corpo, por isso cada
 *    consulta com filtros distintos tem o seu próprio cache).
 *  - ESCRITAS (insert/update/delete e RPCs de efeito): sem rede entram numa
 *    fila persistente (localStorage) e são reenviadas automaticamente quando
 *    a ligação voltar. O utilizador recebe uma mensagem clara a dizer que a
 *    alteração ficou guardada.
 *
 * A autenticação (/auth/v1/) e o storage (/storage/v1/) NÃO são interceptados:
 * o login exige ligação na primeira vez; depois disso a sessão persiste e o
 * RequireAuth permite abrir o painel offline com a sessão local válida.
 */

export const CODIGO_OFFLINE = 'OFFLINE_PENDENTE'

const CHAVE_FILA = 'siga_fila_offline'
const CHAVE_FALHAS = 'siga_falhas_sincronismo'
const NOME_CACHE = 'siga-api-cache'
const MAX_CACHE = 200
const MAX_FILA = 300

/** RPCs de consulta (sem efeitos secundários) — podem ser servidas do cache. */
const RPC_LEITURA = new Set([
  'listar_utilizadores_staff',
  'listar_formadores_contas',
  'localizar_inscricao_para_docs',
  'consultar_inscricao_publica',
  // Portal dos formadores / notas (leituras puras: sem elas a página offline
  // mostraria “alteração guardada” para algo que nem é uma alteração).
  'formador_actual',
  'pautas_do_formador',
  'pauta_da_turma',
  'resumo_turma',
  'historico_notas_aluno',
])

/** RPCs que não devem entrar na fila (verificação de segurança, sem efeito). */
const RPC_SEM_FILA = new Set(['verificar_codigo_financas'])

/** Headers reproduzidos na reenvio (o Authorization é sempre reconstruído). */
const HEADERS_REPRODUZIR = new Set([
  'content-type',
  'prefer',
  'accept',
  'accept-profile',
  'content-profile',
])

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key'

const fetchOriginal = window.fetch.bind(window)

// ---------------------------------------------------------------------------
// Estado global (para a barra de estado offline)
// ---------------------------------------------------------------------------

export interface EstadoOffline {
  online: boolean
  sincronizando: boolean
  pendentes: number
  falhas: number
}

export interface ItemFila {
  id: string
  metodo: string
  caminho: string
  corpo: string | null
  headers: Record<string, string>
  criadoEm: string
}

export interface FalhaSincronismo extends ItemFila {
  motivo: string
  quando: string
}

let estado: EstadoOffline = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  sincronizando: false,
  pendentes: lerFila().length,
  falhas: lerFalhas().length,
}

const ouvintes = new Set<(e: EstadoOffline) => void>()

export function getEstadoOffline(): EstadoOffline {
  return estado
}

export function subscreverEstado(fn: (e: EstadoOffline) => void): () => void {
  ouvintes.add(fn)
  return () => {
    ouvintes.delete(fn)
  }
}

function actualizarEstado(patch: Partial<EstadoOffline>) {
  estado = { ...estado, ...patch }
  ouvintes.forEach((fn) => fn(estado))
}

// ---------------------------------------------------------------------------
// Fila de escritas pendentes + registo de falhas (localStorage)
// ---------------------------------------------------------------------------

function lerFila(): ItemFila[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? '[]') as unknown
    return Array.isArray(v) ? (v as ItemFila[]) : []
  } catch {
    return []
  }
}

function guardarFila(fila: ItemFila[]) {
  if (fila.length === 0) localStorage.removeItem(CHAVE_FILA)
  else localStorage.setItem(CHAVE_FILA, JSON.stringify(fila))
}

function lerFalhas(): FalhaSincronismo[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_FALHAS) ?? '[]') as unknown
    return Array.isArray(v) ? (v as FalhaSincronismo[]) : []
  } catch {
    return []
  }
}

export function listarFalhas(): FalhaSincronismo[] {
  return lerFalhas()
}

function registarFalha(item: ItemFila, motivo: string) {
  const falhas = lerFalhas()
  falhas.push({ ...item, motivo, quando: new Date().toISOString() })
  localStorage.setItem(CHAVE_FALHAS, JSON.stringify(falhas.slice(-50)))
}

function novoId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

// ---------------------------------------------------------------------------
// Cache de leituras (Cache API, com fallback silencioso se indisponível)
// ---------------------------------------------------------------------------

function cacheDisponivel(): boolean {
  return typeof caches !== 'undefined'
}

/** Chave de cache sintética (GET) incluindo o corpo — cada consulta/distinto filtro tem a sua entrada. */
function chaveCache(url: string, corpo: string | null): Request {
  return new Request(`https://siga-cache.local/${encodeURIComponent(`${url}\n${corpo ?? ''}`)}`)
}

async function guardarCache(chave: Request, resposta: Response) {
  if (!cacheDisponivel()) return
  try {
    const cache = await caches.open(NOME_CACHE)
    await cache.put(chave, resposta)
    const todas = await cache.keys()
    if (todas.length > MAX_CACHE) {
      for (const k of todas.slice(0, todas.length - MAX_CACHE)) await cache.delete(k)
    }
  } catch {
    /* quota/indisponível: segue sem cache */
  }
}

async function lerCache(chave: Request): Promise<Response | null> {
  if (!cacheDisponivel()) return null
  try {
    const cache = await caches.open(NOME_CACHE)
    const guardada = await cache.match(chave)
    return guardada ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Erros de rede do fetch (offline, DNS, ligação caída) — não inclui AbortError. */
function ehFalhaRede(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false
  const e = err as { name?: string; message?: string } | null
  return (
    err instanceof TypeError ||
    e?.name === 'TypeError' ||
    e?.name === 'NetworkError' ||
    (typeof e?.message === 'string' && /failed to fetch|networkerror|load failed/i.test(e.message))
  )
}

function respostaErro(status: number, mensagem: string): Response {
  return new Response(JSON.stringify({ code: CODIGO_OFFLINE, message: mensagem, details: '', hint: '' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function extrairRpc(url: string): string | null {
  const m = /\/rest\/v1\/rpc\/([^?/]+)/.exec(url)
  return m ? decodeURIComponent(m[1]) : null
}

async function analisarPedido(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ url: string; metodo: string; corpo: string | null; headers: Record<string, string> }> {
  const req = input instanceof Request ? input : null
  const url = req ? req.url : String(input)
  const metodo = (init?.method ?? req?.method ?? 'GET').toUpperCase()

  let corpo: string | null = null
  const body = init?.body ?? req?.body ?? null
  if (typeof body === 'string') corpo = body
  else if (body instanceof URLSearchParams) corpo = body.toString()
  else if (req && !init?.body) {
    try {
      corpo = await req.clone().text()
    } catch {
      corpo = null
    }
  }

  const headers: Record<string, string> = {}
  const juntar = (h: Headers | HeadersInit | null | undefined) => {
    if (!h) return
    if (h instanceof Headers) h.forEach((v, k) => (headers[k.toLowerCase()] = v))
    else if (Array.isArray(h)) h.forEach(([k, v]) => (headers[k.toLowerCase()] = v))
    else
      Object.entries(h as Record<string, string>).forEach(([k, v]) => {
        headers[k.toLowerCase()] = v
      })
  }
  juntar(init?.headers)
  juntar(req?.headers)

  return { url, metodo, corpo, headers }
}

// ---------------------------------------------------------------------------
// Interceptação do fetch
// ---------------------------------------------------------------------------

const fetchInterceptado = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const info = await analisarPedido(input, init)
  if (!info.url.includes('/rest/v1/')) return fetchOriginal(input, init)

  const rpc = extrairRpc(info.url)
  const ehLeitura = info.metodo === 'GET' || (rpc !== null && RPC_LEITURA.has(rpc))

  if (!ehLeitura) {
    // ---- Escrita -----------------------------------------------------------
    if (rpc !== null && RPC_SEM_FILA.has(rpc)) {
      try {
        return await fetchOriginal(input, init)
      } catch (err) {
        if (ehFalhaRede(err)) {
          return respostaErro(503, 'Sem ligação à internet — esta verificação só é possível online.')
        }
        throw err
      }
    }
    try {
      return await fetchOriginal(input, init)
    } catch (err) {
      if (!ehFalhaRede(err)) throw err
      // Sem rede: guarda na fila e responde como erro amigável (as páginas
      // mostram a mensagem; a alteração será reenviada automaticamente).
      if ((info.corpo?.length ?? 0) > 100_000) {
        return respostaErro(503, 'Sem ligação à internet — esta operação é demasiado grande para a fila offline.')
      }
      const fila = lerFila()
      if (fila.length >= MAX_FILA) {
        return respostaErro(503, 'Fila offline cheia — sincronize antes de continuar.')
      }
      fila.push({
        id: novoId(),
        metodo: info.metodo,
        caminho: info.url,
        corpo: info.corpo,
        headers: Object.fromEntries(
          Object.entries(info.headers).filter(([k]) => HEADERS_REPRODUZIR.has(k)),
        ),
        criadoEm: new Date().toISOString(),
      })
      guardarFila(fila)
      actualizarEstado({ pendentes: fila.length })
      return respostaErro(
        503,
        'Sem ligação à internet: a alteração foi guardada neste computador e será sincronizada automaticamente quando a ligação voltar.',
      )
    }
  }

  // ---- Leitura ------------------------------------------------------------
  if ((info.corpo?.length ?? 0) > 50_000) return fetchOriginal(input, init)
  const chave = chaveCache(info.url, info.corpo)
  try {
    const resp = await fetchOriginal(input, init)
    if (resp.ok) void guardarCache(chave, resp.clone())
    return resp
  } catch (err) {
    if (!ehFalhaRede(err)) throw err
    const guardada = await lerCache(chave)
    if (guardada) return guardada
    return respostaErro(
      503,
      'Sem ligação à internet e sem dados guardados neste computador para esta consulta. Tente novamente quando a ligação voltar.',
    )
  }
}

// ---------------------------------------------------------------------------
// Sincronização da fila (reenvio automático ao voltar online)
// ---------------------------------------------------------------------------

export async function sincronizarAgora(): Promise<void> {
  if (estado.sincronizando || !navigator.onLine) return
  const fila = lerFila()
  if (fila.length === 0) return

  actualizarEstado({ sincronizando: true })

  // Token atual (se houver sessão); pedidos públicos seguem só com a apikey,
  // exatamente como o cliente Supabase faz online.
  let token: string | null = null
  try {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token ?? null
  } catch {
    token = null
  }

  let sincronizadas = 0
  let falhasNovas = 0

  for (const item of fila) {
    try {
      const headers: Record<string, string> = { ...item.headers, apikey: ANON_KEY }
      if (token) headers.Authorization = `Bearer ${token}`

      const resp = await fetchOriginal(item.caminho, {
        method: item.metodo,
        headers,
        body: item.corpo ?? undefined,
      })

      if (resp.ok) {
        sincronizadas++
      } else {
        let motivo = `o servidor recusou (HTTP ${resp.status})`
        try {
          const txt = (await resp.json()) as { message?: string }
          if (txt?.message) motivo = txt.message
        } catch {
          /* corpo não-JSON */
        }
        registarFalha(item, motivo)
        falhasNovas++
      }
    } catch {
      // A rede caiu a meio da sincronização: mantém o resto na fila.
      break
    }
    guardarFila(lerFila().filter((f) => f.id !== item.id))
  }

  const restantes = lerFila().length
  actualizarEstado({ sincronizando: false, pendentes: restantes, falhas: lerFalhas().length })

  if (sincronizadas > 0) {
    pushToast(
      `${sincronizadas} alteração(ões) sincronizada(s) com o servidor. A actualizar os dados…`,
      'sucesso',
    )
    // Recarrega para mostrar a verdade do servidor (matrículas, números, estados).
    window.setTimeout(() => {
      if (document.visibilityState === 'visible') window.location.reload()
    }, 2500)
  }
  if (falhasNovas > 0) {
    pushToast(
      `${falhasNovas} alteração(ões) não foi(ram) aceite(s) pelo servidor — toque no aviso para ver os motivos.`,
      'erro',
    )
  }
  if (restantes > 0 && falhasNovas === 0) {
    pushToast(`Restam ${restantes} alteração(ões) por sincronizar — nova tentativa automática em breve.`, 'info')
  }
}

// ---------------------------------------------------------------------------
// Sessão offline ( RequireAuth usa isto para abrir o painel sem rede )
// ---------------------------------------------------------------------------

function decodificarJwt(token: string): { exp?: number } | null {
  try {
    const payload = token.split('.')[1] ?? ''
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4)
    return JSON.parse(atob(base64)) as { exp?: number }
  } catch {
    return null
  }
}

/**
 * Existe uma sessão guardada neste computador com token ainda válido?
 * Usado quando não há rede (o Supabase não consegue renovar/verificar).
 */
export function sessaoLocalOffline(): boolean {
  try {
    const host = (import.meta.env.VITE_SUPABASE_URL || '').replace(/^https?:\/\//, '').split('/')[0]
    const ref = host.split('.')[0]
    if (!ref) return false
    const bruto = localStorage.getItem(`sb-${ref}-auth-token`)
    if (!bruto) return false
    let sessao: unknown = JSON.parse(bruto)
    if (typeof sessao === 'string') sessao = JSON.parse(sessao)
    const token = (sessao as { access_token?: string } | null)?.access_token
    if (!token) return false
    const payload = decodificarJwt(token)
    return typeof payload?.exp === 'number' && payload.exp * 1000 > Date.now()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

window.fetch = fetchInterceptado

window.addEventListener('online', () => {
  actualizarEstado({ online: true })
  void sincronizarAgora()
})

window.addEventListener('offline', () => {
  actualizarEstado({ online: false })
})

// Rede tenta de novo periodicamente (o evento 'online' nem sempre dispara).
window.setInterval(() => {
  if (navigator.onLine && lerFila().length > 0) void sincronizarAgora()
}, 45_000)

// Sincroniza o que ficou pendente de sessões anteriores.
if (navigator.onLine) window.setTimeout(() => void sincronizarAgora(), 2000)
