/**
 * ============================================================================
 * SERVIÇOS DE INTEGRAÇÃO — Painel da Secretaria ↔ Supabase
 * ============================================================================
 * Funções de alto nível usadas pelo painel administrativo, com tratamento
 * completo de erros (try/catch) e alertas de confirmação para a secretaria.
 *
 * Requer a migration `002_matricula_transacional.sql` (RPC matricular_aluno).
 */

import { supabase } from './supabase'
import { showError, showSuccess } from './alerts'
import type { Inscricao, Turma } from '../types/database'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ResultadoOperacao {
  ok: boolean
  /** Nº de estudante gerado, quando aplicável. */
  numeroEstudante?: string
  /** Mensagem de erro amigável quando ok = false. */
  erro?: string
}

/** Extrai uma mensagem legível de qualquer erro (PostgrestError, Error, RPC). */
function mensagemErro(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return fallback
}

/** Conta documentos ainda não validados de uma inscrição (0 se não houver). */
export async function contarDocumentosPendentes(inscricaoId: string): Promise<number> {
  const { count, error } = await supabase
    .from('documentos_inscricao')
    .select('id', { count: 'exact', head: true })
    .eq('inscricao_id', inscricaoId)
    .eq('estado_validacao', false)

  if (error) return 0 // se falhar a contagem, o trigger do banco continua a proteger
  return count ?? 0
}

// ---------------------------------------------------------------------------
// 1. aprovarInscricao — estado 'aprovado' + matrícula + incremento de vagas
// ---------------------------------------------------------------------------

/**
 * Aprova a inscrição e matricula o candidato numa turma, ATOMICAMENTE:
 *  1. Altera o estado da inscrição para 'aprovado';
 *  2. Cria o registo em `alunos_matriculados` com numero_estudante único
 *     (gerado pela RPC `matricular_aluno`, formato EST-<ano>-<sequencial>);
 *  3. Incrementa `vagas_preenchidas` na turma.
 *
 * A operação é executada por uma função RPC transacional no PostgreSQL: se
 * qualquer passo falhar (turma sem vagas, inscrição já matriculada, etc.),
 * NADA é gravado. Passe `turmaId = null` apenas para aprovar sem matricular.
 */
export async function aprovarInscricao(
  inscricaoId: string,
  turmaId: string | null,
): Promise<ResultadoOperacao> {
  try {
    // -- Passo 0: regra "todos os documentos validados" (pre-check UX) --------
    // O banco também bloqueia (trigger da migration 003); aqui antecipamos o
    // erro com uma mensagem clara antes de tentar gravar.
    const pendentes = await contarDocumentosPendentes(inscricaoId)
    if (pendentes > 0) {
      const msg = `Não é possível aprovar: ${pendentes} documento(s) ainda sem validação. Valide todos os documentos primeiro.`
      showError(msg)
      return { ok: false, erro: msg }
    }

    // -- Passo 1: aprovar ----------------------------------------------------
    const { error: erroAprovar } = await supabase
      .from('inscricoes')
      .update({ estado: 'aprovado', motivo_rejeicao: null })
      .eq('id', inscricaoId)

    if (erroAprovar) {
      throw new Error(mensagemErro(erroAprovar, 'Não foi possível aprovar a inscrição.'))
    }

    // -- Passo 2 + 3: matricular (RPC transacional) ---------------------------
    if (turmaId) {
      const { data, error } = await supabase.rpc('matricular_aluno', {
        p_inscricao_id: inscricaoId,
        p_turma_id: turmaId,
      })

      if (error) {
        // Tentar reverter a aprovação para manter consistência visível
        await supabase.from('inscricoes').update({ estado: 'pendente' }).eq('id', inscricaoId)
        throw new Error(mensagemErro(error, 'Aprovação gravada, mas a matrícula falhou. Estado revertido.'))
      }

      const r = (Array.isArray(data) ? data[0] : data) as
        | { sucesso: boolean; numero_estudante: string | null; mensagem: string }
        | undefined

      if (!r?.sucesso) {
        await supabase.from('inscricoes').update({ estado: 'pendente' }).eq('id', inscricaoId)
        throw new Error(r?.mensagem ?? 'A matrícula foi recusada pelo servidor.')
      }

      showSuccess(`Inscrição aprovada! Nº de estudante: ${r.numero_estudante}`)
      return { ok: true, numeroEstudante: r.numero_estudante ?? undefined }
    }

    // Aprovação sem matrícula imediata (alocação ficará para depois)
    showSuccess('Inscrição aprovada. Aloque o candidato numa turma em "Alunos & Turmas".')
    return { ok: true }
  } catch (e) {
    const msg = mensagemErro(e, 'Erro inesperado ao aprovar a inscrição.')
    showError(msg)
    return { ok: false, erro: msg }
  }
}

// ---------------------------------------------------------------------------
// 2. rejeitarInscricao — estado 'rejeitado' + motivo_rejeicao
// ---------------------------------------------------------------------------

/**
 * Rejeita a inscrição registando o motivo. A constraint do banco exige
 * motivo preenchido quando estado = 'rejeitado'.
 */
export async function rejeitarInscricao(
  inscricaoId: string,
  motivo: string,
): Promise<ResultadoOperacao> {
  try {
    const motivoLimpo = motivo.trim()
    if (!motivoLimpo) {
      throw new Error('O motivo da rejeição é obrigatório.')
    }

    const { error } = await supabase
      .from('inscricoes')
      .update({ estado: 'rejeitado', motivo_rejeicao: motivoLimpo })
      .eq('id', inscricaoId)

    if (error) {
      throw new Error(mensagemErro(error, 'Não foi possível rejeitar a inscrição.'))
    }

    showSuccess('Inscrição rejeitada. O motivo ficou registado no sistema.')
    return { ok: true }
  } catch (e) {
    const msg = mensagemErro(e, 'Erro inesperado ao rejeitar a inscrição.')
    showError(msg)
    return { ok: false, erro: msg }
  }
}

// ---------------------------------------------------------------------------
// 3. obterDocumentoAssinado — Signed URL (10 min) para Storage privado
// ---------------------------------------------------------------------------

/**
 * Gera uma URL temporária assinada (expira em 10 minutos) para visualizar
 * um ficheiro num bucket PRIVADO do Supabase Storage.
 *
 * Aceita dois formatos:
 *  - Path do objecto dentro do bucket: "inscricoes/uuid/bi.pdf"
 *    (neste caso indique também `bucket`);
 *  - URL pública completa: "https://<proj>.supabase.co/storage/v1/object/sign/<bucket>/<path>?..."
 *    (o bucket e o path são extraídos automaticamente).
 *
 * @returns A signed URL pronta para usar em <img src> / <iframe src> / window.open.
 */
export async function obterDocumentoAssinado(
  urlStorage: string,
  bucket = 'documentos-inscricao',
  validadeSegundos = 600, // 10 minutos
): Promise<string> {
  try {
    if (!urlStorage) {
      throw new Error('URL do documento vazia.')
    }

    let bucketFinal = bucket
    let path = urlStorage

    // Detecta URL completa do Storage e extrai bucket + path
    const m = urlStorage.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+?)(?:\?|$)/)
    if (m) {
      bucketFinal = m[1]
      path = decodeURIComponent(m[2])
    }

    const { data, error } = await supabase.storage
      .from(bucketFinal)
      .createSignedUrl(path, validadeSegundos)

    if (error) {
      throw new Error(mensagemErro(error, 'Ficheiro não encontrado no armazenamento.'))
    }
    if (!data?.signedUrl) {
      throw new Error('O servidor não devolveu uma URL válida.')
    }

    return data.signedUrl
  } catch (e) {
    const msg = mensagemErro(e, 'Erro ao gerar link seguro do documento.')
    showError(msg)
    throw new Error(msg)
  }
}

// ---------------------------------------------------------------------------
// Extra: matricular inscrição JÁ aprovada (usado na fila de "Alunos & Turmas")
// ---------------------------------------------------------------------------

/** Matricula uma inscrição já aprovada numa turma via RPC transacional. */
export async function matricularEmTurma(
  inscricaoId: string,
  turmaId: string,
): Promise<ResultadoOperacao> {
  try {
    const { data, error } = await supabase.rpc('matricular_aluno', {
      p_inscricao_id: inscricaoId,
      p_turma_id: turmaId,
    })

    if (error) {
      throw new Error(mensagemErro(error, 'Não foi possível efectuar a matrícula.'))
    }

    const r = (Array.isArray(data) ? data[0] : data) as
      | { sucesso: boolean; numero_estudante: string | null; mensagem: string }
      | undefined

    if (!r?.sucesso) {
      throw new Error(r?.mensagem ?? 'A matrícula foi recusada pelo servidor.')
    }

    showSuccess(`Matrícula efectuada! Nº de estudante: ${r.numero_estudante}`)
    return { ok: true, numeroEstudante: r.numero_estudante ?? undefined }
  } catch (e) {
    const msg = mensagemErro(e, 'Erro inesperado ao matricular.')
    showError(msg)
    return { ok: false, erro: msg }
  }
}

// ---------------------------------------------------------------------------
// Extra: validação de documento (marcar como validado/não validado)
// ---------------------------------------------------------------------------

export async function validarDocumento(documentoId: string, validado: boolean): Promise<ResultadoOperacao> {
  try {
    const { error } = await supabase
      .from('documentos_inscricao')
      .update({ estado_validacao: validado })
      .eq('id', documentoId)

    if (error) {
      throw new Error(mensagemErro(error, 'Não foi possível actualizar o documento.'))
    }
    return { ok: true }
  } catch (e) {
    const msg = mensagemErro(e, 'Erro inesperado ao validar documento.')
    showError(msg)
    return { ok: false, erro: msg }
  }
}

// ---------------------------------------------------------------------------
// Extra: validação em massa — aprovar e alocar todas de uma só vez
// ---------------------------------------------------------------------------

/** Item do resumo da validação em massa (nº e nome da candidatura). */
export interface ItemMassa {
  numero: string
  nome: string
}

export interface ResumoValidacaoMassa {
  /** Inscrições encontradas para processar nesta ronda. */
  total: number
  /** Aprovadas e matriculadas com sucesso nesta ronda. */
  alocadas: number
  /** Documentos que ficaram marcados como validados. */
  docsValidados: number
  /** Sem turma do turno pretendido com vagas — ficaram como estavam. */
  semTurma: ItemMassa[]
  /** Falharam na BD — a aprovação (se feita) foi revertida. */
  comErro: (ItemMassa & { erro: string })[]
}

export type ResultadoMassa =
  | { estado: 'ok'; resumo: ResumoValidacaoMassa }
  | { estado: 'cancelado' }
  | { estado: 'erro'; erro: string }

/** Tamanho da página ao varrer listas em massa (limite do PostgREST). */
const LIMITE_PAGINA = 1000

/** Ids de inscrição que já têm matrícula (consulta em blocos de 200). */
async function inscricoesMatriculadas(ids: string[]): Promise<Set<string>> {
  const conjunto = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('alunos_matriculados')
      .select('inscricao_id')
      .in('inscricao_id', ids.slice(i, i + 200))
    if (error) throw new Error(mensagemErro(error, 'Não foi possível verificar as matrículas existentes.'))
    for (const linha of data ?? []) {
      if (linha.inscricao_id) conjunto.add(linha.inscricao_id)
    }
  }
  return conjunto
}

/** Todas as inscrições pendentes ou aprovadas ainda sem matrícula, por ordem cronológica. */
async function carregarInscricoesPorValidar(): Promise<Inscricao[]> {
  const lista: Inscricao[] = []
  for (let inicio = 0; ; inicio += LIMITE_PAGINA) {
    const { data, error } = await supabase
      .from('inscricoes')
      .select('*')
      .in('estado', ['pendente', 'aprovado'])
      .order('created_at', { ascending: true })
      .range(inicio, inicio + LIMITE_PAGINA - 1)
    if (error) throw new Error(mensagemErro(error, 'Não foi possível carregar as inscrições.'))
    lista.push(...((data ?? []) as Inscricao[]))
    if (!data || data.length < LIMITE_PAGINA) break
  }

  const idsAprovadas = lista.filter((i) => i.estado === 'aprovado').map((i) => i.id)
  const matriculadas = await inscricoesMatriculadas(idsAprovadas)
  return lista.filter((i) => !matriculadas.has(i.id))
}

/** Turmas por ano lectivo desc (prefere-se a mais recente). */
async function carregarTurmas(): Promise<Turma[]> {
  const { data, error } = await supabase
    .from('turmas')
    .select('*')
    .order('ano_lectivo', { ascending: false })
  if (error) throw new Error(mensagemErro(error, 'Não foi possível carregar as turmas.'))
  return (data ?? []) as Turma[]
}

/**
 * Primeira turma do curso da inscrição com o turno pretendido e vagas livres.
 * `turmas` vem ordenada por ano lectivo desc, por isso a mais recente fica
 * primeira. `vagas` tem em conta as alocações já feitas nesta ronda.
 */
function escolherTurma(turmas: Turma[], inscricao: Inscricao, vagas: Map<string, number>): Turma | null {
  return (
    turmas.find(
      (t) =>
        t.curso_id === inscricao.curso_id &&
        t.turno === inscricao.turno_pretendido &&
        (vagas.get(t.id) ?? 0) > 0,
    ) ?? null
  )
}

/** Marca como validados todos os documentos ainda pendentes da inscrição. */
async function validarDocumentosPendentes(inscricaoId: string): Promise<number> {
  const { data, error } = await supabase
    .from('documentos_inscricao')
    .update({ estado_validacao: true })
    .eq('inscricao_id', inscricaoId)
    .eq('estado_validacao', false)
    .select('id')
  if (error) throw new Error(mensagemErro(error, 'Não foi possível validar os documentos.'))
  return data?.length ?? 0
}

/**
 * Valida e matricula TODAS as inscrições pendentes — mais as aprovadas ainda
 * sem turma — num só clique:
 *  1. marca os documentos pendentes como validados;
 *  2. aprova a inscrição (trigger 003 já não bloqueia);
 *  3. aloca o candidato na primeira turma do seu curso com o turno pretendido
 *     e vagas, via RPC `matricular_aluno` (transacional, com lock de vagas).
 *
 * Sem turma disponível ou falha na BD: a inscrição fica como estava (a
 * aprovação é revertida) e é listada no resumo. `confirmar` é chamado antes
 * de escrever qualquer coisa na BD.
 */
export async function validarTodasInscricoes(opcoes: {
  confirmar: (contagens: { pendentes: number; aprovadas: number }) => Promise<boolean>
  onProgresso?: (feitas: number, total: number) => void
}): Promise<ResultadoMassa> {
  try {
    const alvo = await carregarInscricoesPorValidar()
    const resumo: ResumoValidacaoMassa = {
      total: alvo.length,
      alocadas: 0,
      docsValidados: 0,
      semTurma: [],
      comErro: [],
    }
    if (alvo.length === 0) return { estado: 'ok', resumo }

    const pendentes = alvo.filter((i) => i.estado === 'pendente').length
    const confirmado = await opcoes.confirmar({ pendentes, aprovadas: alvo.length - pendentes })
    if (!confirmado) return { estado: 'cancelado' }

    const turmas = await carregarTurmas()
    const vagas = new Map<string, number>()
    for (const t of turmas) vagas.set(t.id, Math.max(0, t.limite_vagas - t.vagas_preenchidas))

    let feitas = 0
    for (const inscricao of alvo) {
      let aprovouAgora = false
      try {
        if (inscricao.estado === 'pendente') {
          resumo.docsValidados += await validarDocumentosPendentes(inscricao.id)
        }

        const turma = escolherTurma(turmas, inscricao, vagas)
        if (!turma) {
          resumo.semTurma.push({ numero: inscricao.numero_inscricao, nome: inscricao.nome_completo })
          continue
        }

        if (inscricao.estado === 'pendente') {
          const { error } = await supabase
            .from('inscricoes')
            .update({ estado: 'aprovado', motivo_rejeicao: null })
            .eq('id', inscricao.id)
          if (error) throw new Error(mensagemErro(error, 'Não foi possível aprovar a inscrição.'))
          aprovouAgora = true
        }

        const { data, error } = await supabase.rpc('matricular_aluno', {
          p_inscricao_id: inscricao.id,
          p_turma_id: turma.id,
        })
        if (error) throw new Error(mensagemErro(error, 'A matrícula falhou.'))

        const r = (Array.isArray(data) ? data[0] : data) as
          | { sucesso: boolean; numero_estudante: string | null; mensagem: string }
          | undefined
        if (!r?.sucesso) throw new Error(r?.mensagem ?? 'A matrícula foi recusada pelo servidor.')

        vagas.set(turma.id, (vagas.get(turma.id) ?? 1) - 1)
        resumo.alocadas++
      } catch (e) {
        // Não deixar "aprovada sem turma": devolve a inscrição ao estado anterior.
        if (aprovouAgora) {
          await supabase.from('inscricoes').update({ estado: 'pendente' }).eq('id', inscricao.id)
        }
        resumo.comErro.push({
          numero: inscricao.numero_inscricao,
          nome: inscricao.nome_completo,
          erro: mensagemErro(e, 'Erro inesperado ao processar a inscrição.'),
        })
      } finally {
        feitas++
        opcoes.onProgresso?.(feitas, alvo.length)
      }
    }

    return { estado: 'ok', resumo }
  } catch (e) {
    return { estado: 'erro', erro: mensagemErro(e, 'Erro inesperado na validação em massa.') }
  }
}
