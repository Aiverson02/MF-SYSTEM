import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { METODO_LABELS, type MetodoPagamento } from '../types/database'
import { fmtMzn } from '../lib/financas'

export interface DadosPagamento {
  data: string
  metodo: MetodoPagamento
  /** Nº do recibo ou da transacção (opcional). */
  referencia: string | null
}

interface Props {
  descricao: string
  /** Valor que vai ser recebido, mostrado no cabeçalho. */
  valor: number
  /** Data por omissão (normalmente hoje). */
  dataInicial?: string
  metodoInicial?: MetodoPagamento
  aGravar?: boolean
  onConfirmar: (dados: DadosPagamento) => Promise<void>
  onClose: () => void
}

/**
 * Registo de um pagamento com forma de pagamento explícita.
 *
 * Antes, «Registar pago» gravava sempre `numerario`; a estatística de físico
 * vs digital ficava errada sem a secretaria perceber porquê.
 */
export default function RegistarPagamentoModal({
  descricao,
  valor,
  dataInicial,
  metodoInicial = 'numerario',
  aGravar = false,
  onConfirmar,
  onClose,
}: Props) {
  useEscapeKey(onClose)
  const hoje = new Date().toISOString().slice(0, 10)
  const [data, setData] = useState(dataInicial ?? hoje)
  const [metodo, setMetodo] = useState<MetodoPagamento>(metodoInicial)
  const [referencia, setReferencia] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!data) {
      setErro('Indique a data do pagamento.')
      return
    }
    setErro(null)
    setLoading(true)
    try {
      await onConfirmar({ data, metodo, referencia: referencia.trim() || null })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível registar o pagamento.')
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <form onSubmit={confirmar} className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-lg">
        <h2 className="font-serif text-lg font-semibold text-ink">Registar pagamento</h2>
        <p className="mt-1 text-[13px] text-ink-muted">{descricao}</p>
        <p className="mt-0.5 font-serif text-[22px] tnum text-ink">{fmtMzn(valor)}</p>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-section mb-1 block">Data</label>
              <input
                type="date"
                className="input w-full"
                value={data}
                onChange={(e) => setData(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label-section mb-1 block">Forma</label>
              <select
                className="input w-full"
                value={metodo}
                onChange={(e) => setMetodo(e.target.value as MetodoPagamento)}
              >
                {(Object.keys(METODO_LABELS) as MetodoPagamento[]).map((m) => (
                  <option key={m} value={m}>
                    {METODO_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label-section mb-1 block">Referência / nº do recibo</label>
            <input
              className="input w-full"
              placeholder="Opcional"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-ink-faint">
            Numerário conta como físico; M-Pesa, e-Mola e transferência contam como digitais.
          </p>
        </div>

        {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading || aGravar} className="btn-primary flex-1">
            {loading || aGravar ? 'A registar...' : 'Confirmar'}
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
