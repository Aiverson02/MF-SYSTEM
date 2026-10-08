import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'mfsiga:financas-desbloqueadas'

/**
 * Gate da área de finanças.
 *
 * Segurança:
 * - O código é validado no SERVIDOR via RPC `verificar_codigo_financas`
 *   (hash bcrypt numa tabela privada, sem policy de leitura). O código nunca
 *   é enviado ao navegador — não está no bundle nem no storage do cliente.
 * - O desbloqueio é PRENDIDO À CONTA autenticada: guarda o user_id e é
 *   limpo automaticamente em logout, mudança de conta, expiração de sessão
 *   ou valor do flag que não corresponder à sessão actual. Terminar a sessão
 *   da secretaria com Pagamentos aberto não deixa o acesso aberto ao seguinte.
 */
function lerFlag(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function limparFlag() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}

export function useFinancas() {
  const [desbloqueado, setDesbloqueado] = useState(() => lerFlag() === '1')
  const [erro, setErro] = useState<string | null>(null)
  const [aValidar, setAValidar] = useState(false)

  // Prende o desbloqueio à sessão: se o utilizador sair, trocar de conta ou a
  // sessão expirar, o flag órfão é removido e a área volta a bloquear.
  useEffect(() => {
    let active = true
    let uidActual: string | null = null

    const revalidar = async () => {
      const { data } = await supabase.auth.getSession()
      if (!active) return
      const uid = data.session?.user?.id ?? null
      uidActual = uid
      const flag = lerFlag()
      // flag formado por user_id => ok só se coincidir com a sessão actual
      if (flag && uid && flag === uid) {
        setDesbloqueado(true)
      } else {
        limparFlag()
        setDesbloqueado(false)
      }
    }

    void revalidar()

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      const uid = session?.user?.id ?? null
      if (event === 'SIGNED_OUT') {
        limparFlag()
        setDesbloqueado(false)
        return
      }
      // mudança de conta no mesmo separador
      if (uidActual && uid && uid !== uidActual) {
        limparFlag()
        setDesbloqueado(false)
      }
      uidActual = uid
      void revalidar()
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const desbloquear = useCallback(async (codigo: string): Promise<boolean> => {
    setAValidar(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('verificar_codigo_financas', { p_codigo: codigo })
      if (error) {
        setErro('Não foi possível validar o código. Tente novamente.')
        return false
      }
      if (data !== true) {
        setErro('Código incorrecto. Peça o código de finanças ao administrador.')
        return false
      }
      const { data: sess } = await supabase.auth.getSession()
      const uid = sess.session?.user?.id
      if (!uid) {
        setErro('Sessão expirada. Entre novamente antes de desbloquear.')
        return false
      }
      try {
        sessionStorage.setItem(STORAGE_KEY, uid)
      } catch {
        /* noop */
      }
      setDesbloqueado(true)
      return true
    } finally {
      setAValidar(false)
    }
  }, [])

  const bloquear = useCallback(() => {
    limparFlag()
    setDesbloqueado(false)
  }, [])

  return { desbloqueado, erro, aValidar, desbloquear, bloquear }
}

/** Limpa o desbloqueio de finanças guardado no sessionStorage. */
export function bloquearFinancas() {
  try {
    sessionStorage.removeItem('mfsiga:financas-desbloqueadas')
  } catch {
    /* noop */
  }
}
