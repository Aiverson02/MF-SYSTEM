/**
 * ============================================================================
 * IMPORTAÇÃO DE ALUNOS (CSV / Excel)
 * ============================================================================
 * A secretaria carrega uma lista de candidatos (CSV ou XLSX), escolhe o curso
 * e o turno dessa lista, e o sistema:
 *   1. lê o ficheiro no browser (nada é enviado antes do utilizador confirmar);
 *   2. cria uma inscrição por linha (RPC `submeter_inscricao_publica`, que já
 *      gera o número e aplica o limite de 3 cursos / duplicados);
 *   3. aprova e matricula cada candidato na primeira turma do curso+turno
 *      escolhidos com vagas — a mesma regra de `matricular_aluno`.
 *
 * Linhas inválidas (sem nome/telefone, datas ilegíveis) não são submetidas e
 * aparecem no resumo antes de escrever na base de dados.
 */

import readXlsxFile from 'read-excel-file'
import { supabase } from './supabase'
import type { EstadoInscricao, Turma, Turno } from '../types/database'

// ---------------------------------------------------------------------------
// Leitura do ficheiro
// ---------------------------------------------------------------------------

const DELIMITADORES = [';', ',', '\t'] as const

/** Texto de uma célula, sem espaços a mais nem "n/a". */
function celula(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).replace(/\s+/g, ' ').trim()
}

/** Divide uma linha CSV respeitando aspas ("" dentro de aspas = aspas). */
function dividirLinha(linha: string, delimitador: string): string[] {
  const campos: string[] = []
  let campo = ''
  let entreAspas = false

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]
    if (entreAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') {
          campo += '"'
          i++
        } else {
          entreAspas = false
        }
      } else {
        campo += c
      }
    } else if (c === '"') {
      entreAspas = true
    } else if (c === delimitador) {
      campos.push(campo)
      campo = ''
    } else {
      campo += c
    }
  }
  campos.push(campo)
  return campos
}

/** Deteta o separador pelo que mais aparece na primeira linha com conteúdo. */
function detetarDelimitador(texto: string): string {
  const primeira = texto.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  let melhor: string = DELIMITADORES[0]
  let melhorContagem = -1
  for (const d of DELIMITADORES) {
    // Conta só fora de aspas: um nome com vírgula não deve decidir o separador.
    const contagem = dividirLinha(primeira, d).length
    if (contagem > melhorContagem) {
      melhor = d
      melhorContagem = contagem
    }
  }
  return melhor
}

/** Lê um CSV ou XLSX (primeira folha) para uma matriz de texto. */
export async function lerFicheiro(file: File): Promise<string[][]> {
  const nome = file.name.toLowerCase()
  if (nome.endsWith('.xlsx') || nome.endsWith('.xlsm')) {
    const linhas = (await readXlsxFile(file)) as unknown[][]
    return linhas.map((l) => l.map(celula))
  }
  if (nome.endsWith('.xls')) {
    throw new Error('O formato .xls antigo não é suportado. Guarde o ficheiro como .xlsx ou .csv.')
  }

  const texto = (await file.text()).replace(/^\uFEFF/, '')
  const delimitador = detetarDelimitador(texto)
  return texto
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => dividirLinha(l, delimitador).map(celula))
}

// ---------------------------------------------------------------------------
// Mapeamento das colunas
// ---------------------------------------------------------------------------

/** Remove acentos, pontuação e caixa: "Nº de BI" → "no de bi". */
function normalizarCabecalho(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const COLUNAS: Record<keyof Campos, string[]> = {
  nome_completo: ['nome', 'nome completo', 'nome do aluno', 'nome do candidato', 'aluno', 'estudante', 'candidato'],
  numero_bi: ['bi', 'numero de bi', 'no de bi', 'nr bi', 'numero do bi', 'bilhete', 'bilhete de identidade'],
  telefone_whatsapp: [
    'telefone',
    'telefone whatsapp',
    'whatsapp',
    'celular',
    'numero de celular',
    'telemovel',
    'contacto',
    'contacto telefonico',
  ],
  email: ['email', 'e mail', 'correio', 'correio eletronico'],
  genero: ['genero', 'sexo'],
  data_nascimento: ['data de nascimento', 'data nascimento', 'nascimento', 'data de nascimento dd mm aaaa'],
}

interface Campos {
  nome_completo: string
  numero_bi: string
  telefone_whatsapp: string
  email: string
  genero: string
  data_nascimento: string
}

export interface LinhaImportada {
  /** Nº da linha no ficheiro (1 = cabeçalho), para o resumo de erros. */
  linha: number
  nome_completo: string
  numero_bi: string | null
  telefone_whatsapp: string
  email: string | null
  genero: 'M' | 'F' | null
  data_nascimento: string | null
  /** Preenchido quando a linha não pode ser importada. */
  erro?: string
}

export interface ResultadoLeitura {
  linhas: LinhaImportada[]
  /** Linhas vazias ou repetidas de cabeçalho, ignoradas em silêncio. */
  ignoradas: number
  /** Cabeçalhos encontrados — mostrados na pré-visualização. */
  colunas: string[]
  /** Avisos não fatais (ex.: coluna de email ausente). */
  avisos: string[]
}

/** Data em 'YYYY-MM-DD': aceita Date do Excel, dd/mm/aaaa e aaaa-mm-dd. */
function normalizarData(valor: string): string | null {
  if (!valor) return null
  const limpo = valor.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(limpo)) return limpo
  const m = limpo.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (!m) return null
  const dia = Number(m[1])
  const mes = Number(m[2])
  const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function normalizarGenero(valor: string): 'M' | 'F' | null {
  const v = normalizarCabecalho(valor)
  if (!v) return null
  if (v === 'm' || v.startsWith('masc')) return 'M'
  if (v === 'f' || v.startsWith('fem')) return 'F'
  return null
}

/**
 * Converte a matriz lida do ficheiro em linhas prontas a importar.
 * O cabeçalho é procurado nas primeiras 10 linhas (por causa de títulos).
 */
export function mapearLinhas(rows: string[][]): ResultadoLeitura {
  const vazio: ResultadoLeitura = { linhas: [], ignoradas: 0, colunas: [], avisos: [] }

  let indiceCabecalho = -1
  let mapa: Partial<Record<keyof Campos, number>> = {}

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cabecalhos = rows[i].map(normalizarCabecalho)
    const encontrado: Partial<Record<keyof Campos, number>> = {}
    cabecalhos.forEach((h, idx) => {
      ;(Object.keys(COLUNAS) as (keyof Campos)[]).forEach((campo) => {
        if (encontrado[campo] === undefined && COLUNAS[campo].includes(h)) encontrado[campo] = idx
      })
    })
    if (encontrado.nome_completo !== undefined && encontrado.telefone_whatsapp !== undefined) {
      indiceCabecalho = i
      mapa = encontrado
      break
    }
  }

  if (indiceCabecalho === -1) {
    throw new Error(
      'Não encontrei as colunas necessárias. O ficheiro precisa de um cabeçalho com, pelo menos, ' +
        '"Nome" e "Telefone" (também aceita BI, Email, Género e Data de Nascimento). ' +
        'Descarregue o modelo para ver o formato.',
    )
  }

  const colunas = Object.entries(mapa)
    .sort((a, b) => a[1] - b[1])
    .map(([campo, idx]) => rows[indiceCabecalho][idx] ?? String(campo))
  const avisos: string[] = []
  if (mapa.telefone_whatsapp === undefined) avisos.push('Sem coluna de telefone — nenhuma linha pode ser importada.')
  if (mapa.email === undefined) avisos.push('Sem coluna de email (opcional).')
  if (mapa.numero_bi === undefined) avisos.push('Sem coluna de BI (opcional — a identidade passa a ser nome + telefone).')

  const valor = (linha: string[], campo: keyof Campos): string => {
    const idx = mapa[campo]
    return idx === undefined ? '' : (linha[idx] ?? '').trim()
  }

  const linhas: LinhaImportada[] = []
  let ignoradas = 0

  rows.slice(indiceCabecalho + 1).forEach((linha, i) => {
    const numeroLinha = indiceCabecalho + 2 + i
    if (linha.every((c) => c === '')) {
      ignoradas++
      return
    }

    // Linha repetida de cabeçalho (ficheiros com folhas coladas).
    const primeiro = normalizarCabecalho(linha[0] ?? '')
    if (primeiro === 'nome' || primeiro === 'nome completo') {
      ignoradas++
      return
    }

    const nome = valor(linha, 'nome_completo')
    const telefoneBruto = valor(linha, 'telefone_whatsapp')
    const telefone = telefoneBruto.replace(/[^\d+]/g, ' ')
    const digitos = telefone.replace(/\D/g, '')
    const email = valor(linha, 'email')
    const data = normalizarData(valor(linha, 'data_nascimento'))

    const importada: LinhaImportada = {
      linha: numeroLinha,
      nome_completo: nome,
      numero_bi: valor(linha, 'numero_bi').toUpperCase() || null,
      telefone_whatsapp: telefoneBruto,
      email: email.includes('@') ? email.toLowerCase() : null,
      genero: normalizarGenero(valor(linha, 'genero')),
      data_nascimento: data,
    }
    if (email && !email.includes('@')) importada.erro = 'Email inválido.'
    else if (!nome || nome.length < 3) importada.erro = 'Nome em falta.'
    else if (digitos.length < 6) importada.erro = 'Telefone em falta ou inválido.'

    linhas.push(importada)
  })

  if (linhas.length === 0) {
    return { ...vazio, colunas, avisos: [...avisos, 'O ficheiro não tem linhas de dados.'] }
  }
  return { linhas, ignoradas, colunas, avisos }
}

// ---------------------------------------------------------------------------
// Importação para a base de dados
// ---------------------------------------------------------------------------

export interface ItemImportacao {
  linha: number
  nome: string
  numero: string
  numeroEstudante: string
}

export interface ResumoImportacao {
  total: number
  /** Inscrições criadas (mesmo que fiquem sem turma). */
  inscritos: number
  /** Inscrições aprovadas e matriculadas com turma. */
  matriculados: number
  semTurma: ItemImportacao[]
  erros: (ItemImportacao & { erro: string })[]
  /** Linhas com erro de dados, que nem chegaram a ser submetidas. */
  invalidas: { linha: number; nome: string; erro: string }[]
}

export type ResultadoImportacao =
  | { estado: 'ok'; resumo: ResumoImportacao }
  | { estado: 'cancelado' }
  | { estado: 'erro'; erro: string }

function mensagemErro(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return fallback
}

/**
 * Cria as inscrições válidas e matricula cada candidato na primeira turma do
 * curso + turno escolhidos com vagas livres. `confirmar` corre antes de
 * escrever na BD.
 */
export async function importarInscricoes(opcoes: {
  linhas: LinhaImportada[]
  cursoId: string
  turno: Turno
  confirmar: (contagens: { validas: number; invalidas: number }) => Promise<boolean>
  onProgresso?: (feitas: number, total: number) => void
}): Promise<ResultadoImportacao> {
  const validas = opcoes.linhas.filter((l) => !l.erro)
  const invalidas = opcoes.linhas
    .filter((l) => l.erro)
    .map((l) => ({ linha: l.linha, nome: l.nome_completo || '—', erro: l.erro! }))

  const resumo: ResumoImportacao = {
    total: opcoes.linhas.length,
    inscritos: 0,
    matriculados: 0,
    semTurma: [],
    erros: [],
    invalidas,
  }
  if (validas.length === 0) return { estado: 'ok', resumo }

  const confirmado = await opcoes.confirmar({ validas: validas.length, invalidas: invalidas.length })
  if (!confirmado) return { estado: 'cancelado' }

  try {
    const { data: turmasData, error: errTurmas } = await supabase
      .from('turmas')
      .select('*')
      .eq('curso_id', opcoes.cursoId)
      .eq('turno', opcoes.turno)
      .order('ano_lectivo', { ascending: false })
    if (errTurmas) throw new Error(mensagemErro(errTurmas, 'Não foi possível carregar as turmas.'))

    const turmas = (turmasData ?? []) as Turma[]
    const vagas = new Map<string, number>()
    for (const t of turmas) vagas.set(t.id, Math.max(0, t.limite_vagas - t.vagas_preenchidas))

    let feitas = 0
    for (const linha of validas) {
      let numero = ''
      try {
        const { data, error } = await supabase.rpc('submeter_inscricao_publica', {
          p_nome_completo: linha.nome_completo,
          p_numero_bi: linha.numero_bi,
          p_data_nascimento: linha.data_nascimento,
          p_genero: linha.genero,
          p_email: linha.email,
          p_telefone_whatsapp: linha.telefone_whatsapp,
          p_curso_id: opcoes.cursoId,
          p_turno_pretendido: opcoes.turno,
        })
        const r = (data as { numero_inscricao: string; inscricao_id: string }[] | null)?.[0]
        if (error || !r?.inscricao_id) {
          throw new Error(
            error?.message ?? 'A inscrição foi recusada pelo servidor. Verifique os dados e o curso escolhido.',
          )
        }
        numero = r.numero_inscricao
        resumo.inscritos++

        const turma = turmas.find((t) => (vagas.get(t.id) ?? 0) > 0)
        if (!turma) {
          resumo.semTurma.push({ linha: linha.linha, nome: linha.nome_completo, numero, numeroEstudante: '' })
          continue
        }

        const { error: errAprovar } = await supabase
          .from('inscricoes')
          .update({ estado: 'aprovado' as EstadoInscricao, motivo_rejeicao: null })
          .eq('id', r.inscricao_id)
        if (errAprovar) throw new Error(mensagemErro(errAprovar, 'Não foi possível aprovar a inscrição.'))

        const { data: matricula, error: errMatricula } = await supabase.rpc('matricular_aluno', {
          p_inscricao_id: r.inscricao_id,
          p_turma_id: turma.id,
        })
        const m = (Array.isArray(matricula) ? matricula[0] : matricula) as
          | { sucesso: boolean; numero_estudante: string | null; mensagem: string }
          | undefined
        if (errMatricula || !m?.sucesso) {
          await supabase.from('inscricoes').update({ estado: 'pendente' as EstadoInscricao }).eq('id', r.inscricao_id)
          throw new Error(errMatricula?.message ?? m?.mensagem ?? 'A matrícula foi recusada pelo servidor.')
        }

        vagas.set(turma.id, (vagas.get(turma.id) ?? 1) - 1)
        resumo.matriculados++
      } catch (e) {
        resumo.erros.push({
          linha: linha.linha,
          nome: linha.nome_completo,
          numero,
          numeroEstudante: '',
          erro: mensagemErro(e, 'Erro inesperado ao importar a linha.'),
        })
      } finally {
        feitas++
        opcoes.onProgresso?.(feitas, validas.length)
      }
    }

    return { estado: 'ok', resumo }
  } catch (e) {
    return { estado: 'erro', erro: mensagemErro(e, 'Erro inesperado na importação.') }
  }
}

/** Modelo CSV (separador ';', compatível com Excel em português). */
export const MODELO_CSV = [
  'Nome;Número de BI;Telefone;Email;Género;Data de Nascimento',
  'Ana Maria Silva;123456789A;+258 84 000 0000;ana@exemplo.co.mz;F;12/03/1998',
  'Carlos Alberto Mussa;;+258 82 111 1111;;M;',
].join('\r\n')
