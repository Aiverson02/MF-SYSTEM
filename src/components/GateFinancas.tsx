import { useState } from 'react'

/**
 * Ecrã de desbloqueio da área de finanças por código.
 * Extraído de Pagamentos para a página Finanças usar exactamente o mesmo gate.
 */
export default function GateFinancas({
  onDesbloquear,
  erro,
  aValidar,
}: {
  onDesbloquear: (c: string) => void
  erro: string | null
  aValidar: boolean
}) {
  const [valor, setValor] = useState('')

  const submeter = (e: React.FormEvent) => {
    e.preventDefault()
    onDesbloquear(valor)
  }

  return (
    <div className="mx-auto max-w-md py-16">
      <div className="cell p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warn-soft text-xl">🔒</div>
        <h2 className="mt-4 font-serif text-xl font-semibold text-ink">Área de Finanças bloqueada</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Introduza o código de acesso para visualizar e gerir os pagamentos.
        </p>
        <form onSubmit={submeter} className="mt-5 space-y-3">
          <input
            type="password"
            className="input w-full text-center font-mono text-lg tracking-[0.3em]"
            placeholder="••••••"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            autoFocus
            autoComplete="off"
          />
          {erro && <p className="text-sm text-danger">{erro}</p>}
          <button type="submit" disabled={aValidar} className="btn-primary w-full py-2.5">
            {aValidar ? 'A validar...' : 'Desbloquear'}
          </button>
        </form>
        <p className="mt-4 text-xs text-ink-faint">
          O código é definido pelo administrador. Contacte-o para obter acesso.
        </p>
      </div>
    </div>
  )
}
