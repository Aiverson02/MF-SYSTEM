import { supabase } from './supabase'
import type { Turno } from '../types/database'

/**
 * Catálogo público da instituição — o que a landing page mostra.
 *
 * Fonte principal: RPC `catalogo_publico()` (migração 031), que junta
 * instituição, edição corrente, locais e cursos com mensalidade e turnos numa
 * só chamada, sem abrir `config_pagamentos` a `anon`.
 *
 * Fallback: se a migração ainda não estiver aplicada, compõe-se o catálogo a
 * partir de `cursos` e `turmas` (leitura pública desde a 001) e usa-se a
 * mensalidade padrão. O formulário continua a funcionar — o preço anunciado é
 * o praticado, mas nunca se inventa uma turma.
 */

export const MENSALIDADE_PADRAO = 200
export const DURACAO_PADRAO = '3 meses'
export const NOME_PADRAO = 'Associação de Formação Profissional Moz Future'

export const TURNOS: Turno[] = ['manha', 'tarde', 'pos_laboral']

export const TURNO_NOMES: Record<Turno, string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
  pos_laboral: 'Pós-laboral',
}

export interface TurnoPublico {
  turno: Turno
  /** null = a edição ainda não tem turmas criadas (vagas desconhecidas). */
  vagas: number | null
}

export interface CursoPublico {
  id: string
  nome: string
  codigo: string
  duracao: string
  descricao: string | null
  /** null = o curso ainda não tem preçário para a edição corrente. */
  mensalidade: number | null
  turnos: TurnoPublico[]
}

export interface LocalPublico {
  id: string
  nome: string
  referencia: string | null
}

export interface InstituicaoPublica {
  nome: string
  telefone: string | null
  email: string | null
  endereco: string | null
  logo_url: string | null
}

export interface Catalogo {
  instituicao: InstituicaoPublica
  /** Número da edição corrente (blocos de 3 meses, migração 032). */
  edicao: number
  /** Ano em que a edição começou. */
  edicaoAno: number | null
  edicaoInicio: string | null
  edicaoFim: string | null
  locais: LocalPublico[]
  cursos: CursoPublico[]
}

/** Edição correspondente a uma data — mesma regra da base de dados. */
export const INICIO_EDICOES = { ano: 2026, mes: 7 }

export function edicaoNaData(d: Date): number {
  const meses = (d.getFullYear() - INICIO_EDICOES.ano) * 12 + (d.getMonth() + 1 - INICIO_EDICOES.mes)
  return Math.floor(meses / 3) + 1
}

const INSTITUICAO_VAZIA: InstituicaoPublica = {
  nome: NOME_PADRAO,
  telefone: null,
  email: null,
  endereco: null,
  logo_url: null,
}

function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(n) ? n : null
}

function turnoValido(valor: unknown): Turno | null {
  return typeof valor === 'string' && (TURNOS as string[]).includes(valor) ? (valor as Turno) : null
}

/** Normaliza o JSON da RPC (o PostgREST devolve `numeric` como número ou texto). */
function normalizar(bruto: unknown): Catalogo | null {
  if (!bruto || typeof bruto !== 'object') return null
  const dados = bruto as Record<string, unknown>
  const cursosBrutos = Array.isArray(dados.cursos) ? dados.cursos : []
  const instituicaoBruta = (dados.instituicao ?? {}) as Record<string, unknown>

  const cursos: CursoPublico[] = cursosBrutos.flatMap((item) => {
    const c = item as Record<string, unknown>
    if (typeof c.id !== 'string' || typeof c.nome !== 'string') return []
    const turnos = (Array.isArray(c.turnos) ? c.turnos : []).flatMap((t) => {
      const turno = turnoValido((t as Record<string, unknown>).turno)
      if (!turno) return []
      const tt = t as Record<string, unknown>
      return [
        {
          turno,
          vagas: tt.vagas === null || tt.vagas === undefined ? null : numero(tt.vagas) ?? 0,
        } satisfies TurnoPublico,
      ]
    })
    return [
      {
        id: c.id,
        nome: c.nome,
        codigo: typeof c.codigo === 'string' ? c.codigo : '',
        duracao: typeof c.duracao === 'string' && c.duracao.trim() ? c.duracao : DURACAO_PADRAO,
        descricao: typeof c.descricao === 'string' && c.descricao.trim() ? c.descricao : null,
        mensalidade: numero(c.mensalidade),
        turnos,
      } satisfies CursoPublico,
    ]
  })

  if (cursos.length === 0) return null

  return {
    instituicao: {
      nome:
        typeof instituicaoBruta.nome === 'string' && instituicaoBruta.nome.trim()
          ? instituicaoBruta.nome
          : NOME_PADRAO,
      telefone: typeof instituicaoBruta.telefone === 'string' ? instituicaoBruta.telefone : null,
      email: typeof instituicaoBruta.email === 'string' ? instituicaoBruta.email : null,
      endereco: typeof instituicaoBruta.endereco === 'string' ? instituicaoBruta.endereco : null,
      logo_url: typeof instituicaoBruta.logo_url === 'string' ? instituicaoBruta.logo_url : null,
    },
    edicao: numero(dados.edicao) ?? edicaoNaData(new Date()),
    edicaoAno: numero(dados.edicao_ano),
    edicaoInicio: typeof dados.edicao_inicio === 'string' ? dados.edicao_inicio : null,
    edicaoFim: typeof dados.edicao_fim === 'string' ? dados.edicao_fim : null,
    locais: (Array.isArray(dados.locais) ? dados.locais : []).flatMap((item) => {
      const l = item as Record<string, unknown>
      if (typeof l.id !== 'string' || typeof l.nome !== 'string') return []
      return [
        {
          id: l.id,
          nome: l.nome,
          referencia: typeof l.referencia === 'string' && l.referencia.trim() ? l.referencia : null,
        } satisfies LocalPublico,
      ]
    }),
    cursos,
  }
}

/** Sem a migração 031: catálogo montado com as tabelas de leitura pública. */
async function catalogoDeReserva(): Promise<Catalogo> {
  const [cursosRes, turmasRes, instituicaoRes] = await Promise.all([
    supabase.from('cursos').select('id, nome, codigo, duracao, descricao').eq('ativo', true),
    supabase.from('turmas').select('id, curso_id, turno, ano_lectivo, limite_vagas, vagas_preenchidas'),
    supabase.from('config_instituicao').select('nome, telefone, email, endereco, logo_url').eq('id', 1).maybeSingle(),
  ])

  const turmas = (turmasRes.data ?? []) as {
    id: string
    curso_id: string
    turno: Turno
    ano_lectivo: number
    limite_vagas: number
    vagas_preenchidas: number
  }[]
  const edicao = edicaoNaData(new Date())

  const cursos = ((cursosRes.data ?? []) as {
    id: string
    nome: string
    codigo: string
    duracao: string | null
    descricao: string | null
  }[]).map((c) => ({
    id: c.id,
    nome: c.nome,
    codigo: c.codigo,
    duracao: c.duracao?.trim() ? c.duracao : DURACAO_PADRAO,
    descricao: c.descricao?.trim() ? c.descricao : null,
    mensalidade: null,
    turnos: turmas
      .filter((t) => t.curso_id === c.id && t.ano_lectivo >= new Date().getFullYear() - 1)
      .map((t) => ({
        turno: t.turno,
        vagas: Math.max((t.limite_vagas ?? 0) - (t.vagas_preenchidas ?? 0), 0),
      })),
  }))

  const inst = (instituicaoRes.data ?? null) as Partial<InstituicaoPublica> | null

  return {
    instituicao: {
      nome: inst?.nome?.trim() ? inst.nome : NOME_PADRAO,
      telefone: inst?.telefone ?? null,
      email: inst?.email ?? null,
      endereco: inst?.endereco ?? null,
      logo_url: inst?.logo_url ?? null,
    },
    edicao,
    edicaoAno: new Date().getFullYear(),
    edicaoInicio: null,
    edicaoFim: null,
    locais: [],
    cursos,
  }
}

export async function carregarCatalogo(): Promise<Catalogo> {
  try {
    const { data, error } = await supabase.rpc('catalogo_publico')
    if (!error) {
      const normalizado = normalizar(data)
      if (normalizado) return normalizado
    }
  } catch {
    /* rede em baixo: tenta a leitura directa abaixo */
  }

  try {
    return await catalogoDeReserva()
  } catch {
    return {
      instituicao: INSTITUICAO_VAZIA,
      edicao: edicaoNaData(new Date()),
      edicaoAno: new Date().getFullYear(),
      edicaoInicio: null,
      edicaoFim: null,
      locais: [],
      cursos: [],
    }
  }
}

/** Turnos a oferecer para um curso: os da edição ou os três habituais. */
export function turnosDoCurso(curso: CursoPublico | null | undefined): TurnoPublico[] {
  if (curso && curso.turnos.length > 0) return curso.turnos
  // Edição ainda sem turmas: oferece os três turnos, sem prometer vagas.
  return TURNOS.map((turno) => ({ turno, vagas: null }))
}

/**
 * Ano da edição que aceita inscrições, calculado pela mesma regra da base de
 * dados (036): o bloco de três meses que vai começar.
 *
 * Serve só de reserva enquanto o catálogo não chega — com a RPC em baixo a
 * página anuncia a edição que o servidor anunciaria.
 */
export function anoInscricoes(d = new Date()): number {
  const meses = (d.getFullYear() - INICIO_EDICOES.ano) * 12 + (d.getMonth() + 1 - INICIO_EDICOES.mes)
  const bloco = Math.floor(meses / 3)
  return new Date(INICIO_EDICOES.ano, INICIO_EDICOES.mes - 1 + (bloco + 1) * 3, 1).getFullYear()
}

/** Valor a mostrar: o preçário do curso ou a mensalidade praticada. */
export function mensalidadeDe(curso: CursoPublico | null | undefined): number {
  return curso?.mensalidade ?? MENSALIDADE_PADRAO
}

/**
 * Preço de tabela (sem curso escolhido): o valor mais frequente do catálogo.
 *
 * O preçário é da secretaria e pode variar por curso ou por edição — a página
 * acompanha-o em vez de anunciar um número fixo que o painel cobra diferente.
 */
export function precoBase(cursos: CursoPublico[]): number {
  const contagem = new Map<number, number>()
  for (const c of cursos) {
    if (c.mensalidade === null) continue
    contagem.set(c.mensalidade, (contagem.get(c.mensalidade) ?? 0) + 1)
  }
  let melhor: number | null = null
  let vezes = 0
  for (const [valor, n] of contagem) {
    // Empate: fica o mais baixo, para nunca anunciar acima do praticado.
    if (n > vezes || (n === vezes && melhor !== null && valor < melhor)) {
      melhor = valor
      vezes = n
    }
  }
  return melhor ?? MENSALIDADE_PADRAO
}

/** Duração de tabela: a mais frequente no catálogo, enquanto nada está escolhido. */
export function duracaoBase(cursos: CursoPublico[]): string {
  const contagem = new Map<string, number>()
  for (const c of cursos) {
    const d = c.duracao?.trim()
    if (d) contagem.set(d, (contagem.get(d) ?? 0) + 1)
  }
  let melhor: string | null = null
  let vezes = 0
  for (const [valor, n] of contagem) {
    if (n > vezes) {
      melhor = valor
      vezes = n
    }
  }
  return melhor ?? DURACAO_PADRAO
}
