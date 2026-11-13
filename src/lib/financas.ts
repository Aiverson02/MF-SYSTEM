import type {
  CategoriaDespesa,
  CategoriaReceita,
  MetodoPagamento,
  MovimentoFinanceiro,
} from '../types/database'
import { CATEGORIA_DESPESA_LABELS, CATEGORIA_RECEITA_LABELS } from '../types/database'

// ---------------------------------------------------------------------------
// Formatação e datas
// ---------------------------------------------------------------------------

export const fmtMzn = (v: number) =>
  new Intl.NumberFormat('pt-MZ', {
    style: 'currency',
    currency: 'MZN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v)

export const fmtPct = (v: number) => `${Math.round(v * 100)}%`

/** Número inteiro de MZN (para rótulos de gráficos). */
export const fmtMznCurto = (v: number) =>
  new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 }).format(v)

function isoDe(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const hojeIso = () => isoDe(new Date())

/** Meio-dia local evita o dia anterior por causa do fuso horário. */
const dataLocal = (iso: string) => new Date(`${iso}T12:00:00`)

export function somarDias(iso: string, dias: number): string {
  const d = dataLocal(iso)
  d.setDate(d.getDate() + dias)
  return isoDe(d)
}

export const inicioDoMes = (iso: string) => `${iso.slice(0, 7)}-01`

export function fimDoMes(iso: string): string {
  const [ano, mes] = iso.split('-').map(Number)
  return isoDe(new Date(ano, mes, 0, 12))
}

/** Lista dos últimos `n` dias, terminando em `fim` (inclusive). */
export function ultimosDias(fim: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => somarDias(fim, i - (n - 1)))
}

export const mesLongo = (iso: string) =>
  dataLocal(iso).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })

export const diaLongo = (iso: string) =>
  dataLocal(iso).toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

export const diaCurto = (iso: string) => {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** `mes_referencia` (dia 1) do mês a que um dia pertence. */
export const mesReferenciaDe = (iso: string) => `${iso.slice(0, 7)}-01`

// ---------------------------------------------------------------------------
// Classificação de métodos: o que é físico e o que é digital
// ---------------------------------------------------------------------------

export type GrupoMetodo = 'fisico' | 'digital' | 'outro'

export const GRUPO_METODO_LABELS: Record<GrupoMetodo, string> = {
  fisico: 'Numerário (físico)',
  digital: 'Pagamentos digitais',
  outro: 'Não especificado',
}

export function grupoDoMetodo(metodo: MetodoPagamento | null): GrupoMetodo {
  if (metodo === 'numerario') return 'fisico'
  if (metodo === 'mpesa' || metodo === 'emola' || metodo === 'transferencia') return 'digital'
  return 'outro'
}

export function categoriaReceitaLabel(categoria: string): string {
  return CATEGORIA_RECEITA_LABELS[categoria as CategoriaReceita] ?? 'Outras receitas'
}

export function categoriaDespesaLabel(categoria: string): string {
  return CATEGORIA_DESPESA_LABELS[categoria as CategoriaDespesa] ?? 'Outros'
}

export function categoriaLabel(m: MovimentoFinanceiro): string {
  return m.sentido === 'saida' ? categoriaDespesaLabel(m.categoria) : categoriaReceitaLabel(m.categoria)
}

// ---------------------------------------------------------------------------
// Agregação — usada pelo ecrã E pelo relatório, para os números coincidirem
// ---------------------------------------------------------------------------

export interface LinhaResumo {
  chave: string
  label: string
  valor: number
  quantidade: number
  /** Fracção do total (0–1) para barras e percentagens. */
  parte: number
}

export interface ResumoFinanceiro {
  bruto: number
  despesas: number
  liquido: number
  entradas: number
  saidas: number
  operacoes: number
  categorias: LinhaResumo[]
  despesasPorCategoria: LinhaResumo[]
  meios: LinhaResumo[]
}

function agrupar(
  movimento: MovimentoFinanceiro[],
  chave: (m: MovimentoFinanceiro) => string,
  label: (chave: string) => string,
  total: number,
): LinhaResumo[] {
  const mapa = new Map<string, { valor: number; quantidade: number }>()
  for (const m of movimento) {
    const k = chave(m)
    const actual = mapa.get(k) ?? { valor: 0, quantidade: 0 }
    actual.valor += Number(m.valor)
    actual.quantidade += 1
    mapa.set(k, actual)
  }
  return [...mapa.entries()]
    .map(([k, v]) => ({
      chave: k,
      label: label(k),
      valor: v.valor,
      quantidade: v.quantidade,
      parte: total > 0 ? v.valor / total : 0,
    }))
    .sort((a, b) => b.valor - a.valor)
}

export function resumirMovimentos(movimentos: MovimentoFinanceiro[]): ResumoFinanceiro {
  const entradas = movimentos.filter((m) => m.sentido === 'entrada')
  const saidas = movimentos.filter((m) => m.sentido === 'saida')
  const bruto = entradas.reduce((s, m) => s + Number(m.valor), 0)
  const despesas = saidas.reduce((s, m) => s + Number(m.valor), 0)

  return {
    bruto,
    despesas,
    liquido: bruto - despesas,
    entradas: entradas.length,
    saidas: saidas.length,
    operacoes: movimentos.length,
    categorias: agrupar(entradas, (m) => m.categoria, categoriaReceitaLabel, bruto),
    despesasPorCategoria: agrupar(saidas, (m) => m.categoria, categoriaDespesaLabel, despesas),
    meios: agrupar(
      entradas,
      (m) => grupoDoMetodo(m.metodo),
      (k) => GRUPO_METODO_LABELS[k as GrupoMetodo],
      bruto,
    ),
  }
}

/** Série diária para o gráfico: entradas, despesas e líquido por dia. */
export interface PontoSerie {
  data: string
  bruto: number
  despesas: number
  liquido: number
}

export function serieDiaria(movimentos: MovimentoFinanceiro[], dias: string[]): PontoSerie[] {
  const mapa = new Map(dias.map((d) => [d, { bruto: 0, despesas: 0 }]))
  for (const m of movimentos) {
    const ponto = mapa.get(m.data)
    if (!ponto) continue
    if (m.sentido === 'entrada') ponto.bruto += Number(m.valor)
    else ponto.despesas += Number(m.valor)
  }
  return dias.map((data) => {
    const p = mapa.get(data) ?? { bruto: 0, despesas: 0 }
    return { data, bruto: p.bruto, despesas: p.despesas, liquido: p.bruto - p.despesas }
  })
}

/**
 * Conferência de caixa: quanto entrou e saiu por grupo de meio de pagamento.
 * O saldo físico é o dinheiro em numerário que deve estar na gaveta.
 */
export interface LinhaCaixa {
  chave: GrupoMetodo
  label: string
  entradas: number
  saidas: number
  saldo: number
}

export interface ResumoCaixa {
  grupos: LinhaCaixa[]
  totalEntradas: number
  totalSaidas: number
  saldoFisico: number
}

export function resumoCaixa(movimentos: MovimentoFinanceiro[]): ResumoCaixa {
  const base = new Map<GrupoMetodo, { entradas: number; saidas: number }>([
    ['fisico', { entradas: 0, saidas: 0 }],
    ['digital', { entradas: 0, saidas: 0 }],
    ['outro', { entradas: 0, saidas: 0 }],
  ])
  for (const m of movimentos) {
    const grupo = grupoDoMetodo(m.metodo)
    const linha = base.get(grupo)!
    if (m.sentido === 'entrada') linha.entradas += Number(m.valor)
    else linha.saidas += Number(m.valor)
  }
  const grupos = (['fisico', 'digital', 'outro'] as GrupoMetodo[]).map((chave) => {
    const l = base.get(chave)!
    return {
      chave,
      label: GRUPO_METODO_LABELS[chave],
      entradas: l.entradas,
      saidas: l.saidas,
      saldo: l.entradas - l.saidas,
    }
  })
  return {
    grupos,
    totalEntradas: grupos.reduce((s, g) => s + g.entradas, 0),
    totalSaidas: grupos.reduce((s, g) => s + g.saidas, 0),
    saldoFisico: grupos[0].saldo,
  }
}

/** Variação relativa (null quando não há base de comparação). */
export function variacao(actual: number, anterior: number): number | null {
  if (anterior === 0) return actual === 0 ? 0 : null
  return (actual - anterior) / Math.abs(anterior)
}
