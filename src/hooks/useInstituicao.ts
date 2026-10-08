import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ConfigInstituicao } from '../types/database'

export const NOME_INSTITUICAO_DEFAULT = 'Centro de Formação'

const DEFAULT_CONFIG: ConfigInstituicao = {
  id: 1,
  nome: NOME_INSTITUICAO_DEFAULT,
  telefone: null,
  email: null,
  endereco: null,
  logo_url: null,
  codigo_financas: null,
  valor_certificado: 350,
  valor_faixa: 500,
  updated_at: '',
  updated_by: null,
}

/**
 * Configuração da instituição (tabela config_instituicao, linha única id=1).
 * Leitura para staff autenticado; escrita admin-only (RLS).
 * O código de finanças NÃO é exposto: vive com hash no servidor.
 */
export function useInstituicao() {
  const [config, setConfig] = useState<ConfigInstituicao>(DEFAULT_CONFIG)

  useEffect(() => {
    let active = true
    void supabase
      .from('config_instituicao')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setConfig({ ...DEFAULT_CONFIG, ...data })
      })
    return () => {
      active = false
    }
  }, [])

  return { ...config, data: config }
}

/** Mantido para compatibilidade com usos antigos que só precisam do nome. */
export function useNomeInstituicao() {
  return useInstituicao().nome
}
