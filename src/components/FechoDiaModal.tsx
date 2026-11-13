import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { showError, showSuccess } from '../lib/alerts'
import type { FechoDia } from '../types/database'
import { fmtMzn } from '../lib/financas'

/**
 * Fecho do dia: guarda a fotografia dos totais com notas e autor.
 * Se o dia já foi fechado, voltar a fechar actualiza a fotografia.
 */
export default function FechoDiaModal({
  data,
  bruto,
  despesas,
  liquido,
  fecho,
  onClose,
  onDone,
}: {
  data: string
  bruto: number
  despesas: number
  liquido: number
  fecho: FechoDia | null
  onClose: () => void
  onDone: () => void
}) {
  useEscapeKey(onClose)
  const [notas, setNotas] = useState(fecho?.notas ?? '')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const fechar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setLoading(true)
    const { data: sessao } = await supabase.auth.getUser()
    const { error } = await supabase.from('fechos_dia').upsert(
      {
        data,
        total_bruto: bruto,
        total_despesas: despesas,
        total_liquido: liquido,
        notas: notas.trim() || null,
        fechado_por: sessao.user?.id ?? null,
        fechado_em: new Date().toISOString(),
      },
      { onConflict: 'data' },
    )
    setLoading(false)
    if (error) {
      showError(error.message)
      return
    }
    showSuccess(fecho ? 'Fecho do dia actualizado.' : 'Dia fechado.')
    onDone()
    onClose()
  }

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <form onSubmit={fechar} className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-lg">
        <h2 className="font-serif text-lg font-semibold text-ink">
          {fecho ? 'Actualizar fecho do dia' : 'Fechar o dia'}
        </h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Os totais ficam guardados como conferência do caixa. Continuam a poder ser corrigidos depois; o sistema
          avisa se os valores mudarem.
        </p>

        <div className="mt-4 rounded-md border border-line px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-ink-muted">Total bruto</span>
            <span className="tnum text-ink">{fmtMzn(bruto)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-ink-muted">Despesas</span>
            <span className="tnum text-ink">− {fmtMzn(despesas)}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-2">
            <span className="text-[13px] font-medium text-ink">Líquido</span>
            <span className={`font-serif text-[20px] tnum ${liquido < 0 ? 'text-danger' : 'text-ink'}`}>
              {fmtMzn(liquido)}
            </span>
          </div>
        </div>

        {fecho && (
          <p className="mt-3 text-[11px] text-ink-faint">
            Fecho anterior: {new Date(fecho.fechado_em).toLocaleString('pt-PT')} · bruto{' '}
            {fmtMzn(Number(fecho.total_bruto))} · líquido {fmtMzn(Number(fecho.total_liquido))}
          </p>
        )}

        <div className="mt-4">
          <label className="label-section mb-1 block">Notas do fecho</label>
          <textarea
            className="input w-full"
            rows={3}
            placeholder="Ex.: falta troco de 100 MT; dois comprovativos por confirmar."
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
        </div>

        {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading ? 'A guardar...' : fecho ? 'Actualizar fecho' : 'Fechar o dia'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
