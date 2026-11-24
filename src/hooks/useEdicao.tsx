import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Edições de três meses.
 *
 * A instituição trabalha por blocos de três meses, numerados desde a primeira
 * edição (Jul–Set/2026 = 1, Out–Dez/2026 = 2, Jan–Mar/2027 = 3, …). A lista e a
 * edição corrente vêm da base de dados (`listar_edicoes`, migração 032): o
 * sistema muda de edição sozinho no primeiro dia do bloco seguinte.
 *
 * O painel guarda a edição escolhida e as páginas filtram por ela, para os
 * dados de uma edição nunca se misturarem com os da seguinte.
 */

export interface Edicao {
  id: string
  numero: number
  inicio: string
  fim: string
  ano: number
  atual: boolean
}

const CHAVE = 'mfsiga.edicao'

interface Contexto {
  edicoes: Edicao[]
  edicao: Edicao | null
  edicaoId: string | null
  setEdicaoId: (id: string) => void
  /** Edição que decorre hoje. */
  corrente: Edicao | null
  carregando: boolean
  recarregar: () => void
}

const Vazio: Contexto = {
  edicoes: [],
  edicao: null,
  edicaoId: null,
  setEdicaoId: () => {},
  corrente: null,
  carregando: true,
  recarregar: () => {},
}

const EdicaoContext = createContext<Contexto>(Vazio)

/** "Edição 3 · 2027" — o rótulo que o painel e o site mostram. */
export function rotuloEdicao(e: Edicao | null | undefined): string {
  return e ? `Edição ${e.numero} · ${e.ano}` : 'Edição —'
}

/** "01/01/2027 – 31/03/2027". */
export function periodoEdicao(e: Edicao | null | undefined): string {
  if (!e) return ''
  const f = (iso: string) => iso.split('-').reverse().join('/')
  return `${f(e.inicio)} – ${f(e.fim)}`
}

function lerGuardada(): string | null {
  try {
    return localStorage.getItem(CHAVE)
  } catch {
    return null
  }
}

export function EdicaoProvider({ children }: { children: React.ReactNode }) {
  const [edicoes, setEdicoes] = useState<Edicao[]>([])
  const [edicaoId, setEdicaoIdEstado] = useState<string | null>(() => lerGuardada())
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase.rpc('listar_edicoes')
    if (!error && Array.isArray(data)) {
      setEdicoes(data as Edicao[])
    }
    setCarregando(false)
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Garante que a edição escolhida existe; senão cai na corrente.
  useEffect(() => {
    if (edicoes.length === 0) return
    const valida = edicaoId ? edicoes.some((e) => e.id === edicaoId) : false
    if (valida) return
    const alvo = edicoes.find((e) => e.atual) ?? edicoes[0]
    setEdicaoIdEstado(alvo?.id ?? null)
    if (alvo) {
      try {
        localStorage.setItem(CHAVE, alvo.id)
      } catch {
        /* modo privado: a escolha não persiste, mas funciona */
      }
    }
  }, [edicoes, edicaoId])

  const setEdicaoId = useCallback((id: string) => {
    setEdicaoIdEstado(id)
    try {
      localStorage.setItem(CHAVE, id)
    } catch {
      /* modo privado */
    }
  }, [])

  const valor = useMemo<Contexto>(() => {
    const edicao = edicoes.find((e) => e.id === edicaoId) ?? null
    return {
      edicoes,
      edicao,
      edicaoId: edicao?.id ?? null,
      setEdicaoId,
      corrente: edicoes.find((e) => e.atual) ?? null,
      carregando,
      recarregar: () => void carregar(),
    }
  }, [edicoes, edicaoId, setEdicaoId, carregando, carregar])

  return <EdicaoContext.Provider value={valor}>{children}</EdicaoContext.Provider>
}

export function useEdicao(): Contexto {
  return useContext(EdicaoContext)
}
