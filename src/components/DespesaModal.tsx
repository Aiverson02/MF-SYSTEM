import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { showError, showSuccess } from '../lib/alerts'
import {
  CATEGORIA_DESPESA_LABELS,
  METODO_LABELS,
  type CategoriaDespesa,
  type MetodoPagamento,
} from '../types/database'

/** Registo de uma despesa do dia seleccionado. */
export default function DespesaModal({
  data,
  onClose,
  onDone,
}: {
  data: string
  onClose: () => void
  onDone: () => void
}) {
  useEscapeKey(onClose)
  const [form, setForm] = useState({
    data,
    categoria: 'material' as CategoriaDespesa,
    descricao: '',
    valor: '',
    metodo: 'numerario' as MetodoPagamento,
    fornecedor: '',
    referencia: '',
    observacoes: '',
  })
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    const valor = Number(form.valor)
    if (!form.descricao.trim()) {
      setErro('Descreva a despesa (ex.: fotocópias do material).')
      return
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      setErro('O valor tem de ser maior do que zero.')
      return
    }
    setErro(null)
    setLoading(true)
    const { error } = await supabase.from('despesas').insert({
      data: form.data,
      categoria: form.categoria,
      descricao: form.descricao.trim(),
      valor,
      metodo: form.metodo,
      fornecedor: form.fornecedor.trim() || null,
      referencia: form.referencia.trim() || null,
      observacoes: form.observacoes.trim() || null,
      criado_por: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    setLoading(false)
    if (error) {
      showError(error.message)
      return
    }
    showSuccess('Despesa registada.')
    onDone()
    onClose()
  }

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <form
        onSubmit={guardar}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-lg"
      >
        <h2 className="font-serif text-lg font-semibold text-ink">Registar despesa</h2>
        <p className="mt-1 text-[13px] text-ink-muted">Saída de caixa da instituição.</p>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-section mb-1 block">Data</label>
              <input
                type="date"
                className="input w-full"
                value={form.data}
                onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label-section mb-1 block">Valor (MZN)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="input w-full tnum"
                placeholder="0,00"
                value={form.valor}
                onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
                required
              />
            </div>
          </div>

          <div>
            <label className="label-section mb-1 block">Categoria</label>
            <select
              className="input w-full"
              value={form.categoria}
              onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value as CategoriaDespesa }))}
            >
              {(Object.keys(CATEGORIA_DESPESA_LABELS) as CategoriaDespesa[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORIA_DESPESA_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-section mb-1 block">Descrição</label>
            <input
              className="input w-full"
              placeholder="Ex.: fotocópias do material do curso"
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-section mb-1 block">Forma de pagamento</label>
              <select
                className="input w-full"
                value={form.metodo}
                onChange={(e) => setForm((f) => ({ ...f, metodo: e.target.value as MetodoPagamento }))}
              >
                {(Object.keys(METODO_LABELS) as MetodoPagamento[]).map((m) => (
                  <option key={m} value={m}>
                    {METODO_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-section mb-1 block">Fornecedor</label>
              <input
                className="input w-full"
                placeholder="Opcional"
                value={form.fornecedor}
                onChange={(e) => setForm((f) => ({ ...f, fornecedor: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="label-section mb-1 block">Nº de factura / recibo</label>
            <input
              className="input w-full"
              placeholder="Opcional"
              value={form.referencia}
              onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))}
            />
          </div>

          <div>
            <label className="label-section mb-1 block">Observações</label>
            <textarea
              className="input w-full"
              rows={2}
              value={form.observacoes}
              onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
            />
          </div>
        </div>

        {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading ? 'A guardar...' : 'Registar despesa'}
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
