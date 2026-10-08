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
