import { supabase } from './supabase'
import type { Turno } from '../types/database'

/**
 * Submissão da inscrição do site.
 *
 * Ordem: RPC pública (cria a inscrição com número, estado `pendente` e a turma
 * da edição corrente) → upload dos ficheiros para o bucket privado
 * `documentos-inscricao` → registo dos anexos.
 *
 * Se um anexo falhar, a inscrição NÃO se perde: devolve-se o número e a lista
 * do que falta, e a secretaria vê no painel que documentos ainda não chegaram.
 */

const BUCKET = 'documentos-inscricao'
export const TAMANHO_MAX_ANEXO = 5 * 1024 * 1024
export const TIPOS_ACEITES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
export const TEXTO_RECIBO_MAX = 1000

export class ErroInscricao extends Error {}

export interface DadosInscricao {
  nomeCompleto: string
  telefone: string
  email: string
  numeroBi: string
  cursoId: string
  turno: Turno
}

export interface AnexosInscricao {
  bi: File | null
  reciboFicheiro: File | null
  reciboTexto: string
}

export interface ResultadoInscricao {
  numero: string
  id: string
  /** Anexos que não chegaram (texto pronto a mostrar). */
  avisos: string[]
}

function extensao(file: File): string {
  const porNome = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(porNome)) return porNome === 'jpeg' ? 'jpg' : porNome
  switch (file.type) {
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'application/pdf':
      return 'pdf'
    default:
      return 'jpg'
  }
}

/** Valida um anexo antes de submeter. Devolve a mensagem de erro ou null. */
export function validarAnexo(file: File | null): string | null {
  if (!file) return null
  if (!TIPOS_ACEITES.includes(file.type)) return 'Só aceitamos JPG, PNG, WebP ou PDF.'
  if (file.size > TAMANHO_MAX_ANEXO) return 'O ficheiro tem de ter no máximo 5 MB.'
  return null
}

function semLigacao(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function mensagemDoErro(erro: { message?: string } | null, alternativa: string): string {
  const texto = erro?.message?.trim()
  if (!texto) return alternativa
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(texto)) {
    return 'Sem ligação à internet. Verifique os dados e tente outra vez.'
  }
  return texto
}

export async function submeterInscricao(
  dados: DadosInscricao,
  anexos: AnexosInscricao,
): Promise<ResultadoInscricao> {
  // A fila offline do painel é da secretaria, não do visitante: aqui um pedido
  // sem rede nunca pode parecer "guardado".
  if (semLigacao()) {
    throw new ErroInscricao('Sem ligação à internet. Ligue-se e tente outra vez — nada foi enviado.')
  }

  const { data, error } = await supabase.rpc('submeter_inscricao_publica', {
    p_nome_completo: dados.nomeCompleto.trim(),
    p_numero_bi: dados.numeroBi.trim() ? dados.numeroBi.trim().toUpperCase() : null,
    p_data_nascimento: null,
    p_genero: null,
    p_email: dados.email.trim() || null,
    p_telefone_whatsapp: dados.telefone.trim(),
    p_curso_id: dados.cursoId,
    p_turno_pretendido: dados.turno,
  })

  const linha = (data as { numero_inscricao: string | null; inscricao_id: string | null }[] | null)?.[0]
  if (error || !linha?.inscricao_id || !linha.numero_inscricao) {
    throw new ErroInscricao(
      mensagemDoErro(error, 'Não foi possível enviar a inscrição. Confirme os dados e o curso escolhido.'),
    )
  }

  const avisos: string[] = []
  const marca = Date.now()

  const enviar = async (file: File, prefixo: string, tipo: 'bi' | 'comprovativo_pagamento', rotulo: string) => {
    const caminho = `${linha.inscricao_id}/${prefixo}-${marca}.${extensao(file)}`
    const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, file, {
      contentType: file.type,
      upsert: false,
    })
    if (erroUpload) {
      avisos.push(`${rotulo} não foi anexado — leve o documento à secretaria.`)
      return
    }
    const { error: erroAnexo } = await supabase.rpc('anexar_documento_inscricao', {
      p_inscricao_id: linha.inscricao_id,
      p_tipo_documento: tipo,
      p_url_ficheiro: caminho,
    })
    if (erroAnexo) avisos.push(`${rotulo} chegou ao servidor mas não ficou registado — leve-o à secretaria.`)
  }

  if (anexos.bi) await enviar(anexos.bi, 'bi', 'bi', 'A foto do BI')
  if (anexos.reciboFicheiro) {
    await enviar(anexos.reciboFicheiro, 'recibo', 'comprovativo_pagamento', 'O comprovativo do pagamento')
  }

  const texto = anexos.reciboTexto.trim()
  if (!anexos.reciboFicheiro && texto) {
    const { error: erroTexto } = await supabase.rpc('anexar_documento_texto', {
      p_inscricao_id: linha.inscricao_id,
      p_tipo_documento: 'comprovativo_pagamento',
      p_texto: texto.slice(0, TEXTO_RECIBO_MAX),
    })
    if (erroTexto) avisos.push('A nota do pagamento não ficou registada — repita-a na secretaria.')
  }

  return { numero: linha.numero_inscricao, id: linha.inscricao_id, avisos }
}
