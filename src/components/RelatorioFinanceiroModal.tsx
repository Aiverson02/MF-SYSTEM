import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '../hooks/useEscapeKey'
import type { FechoDia, MetodoPagamento, MovimentoFinanceiro } from '../types/database'
import { METODO_LABELS } from '../types/database'
import { exportToCsv, nomeFicheiro } from '../lib/exportCsv'
import { abrirRelatorioFinanceiro } from '../lib/relatorioFinanceiro'
import { diaLongo, fmtMzn, mesLongo, resumirMovimentos, serieDiaria } from '../lib/financas'

function csvMovimentos(movimentos: MovimentoFinanceiro[], nome: string) {
  exportToCsv<MovimentoFinanceiro>(
    nomeFicheiro(nome),
    [
      { header: 'Data', value: (m) => m.data },
      { header: 'Tipo', value: (m) => (m.sentido === 'entrada' ? 'Entrada' : 'Saída') },
      { header: 'Rubrica', value: (m) => m.categoria },
      { header: 'Descrição', value: (m) => m.descricao },
      { header: 'Aluno', value: (m) => m.aluno_nome ?? '' },
      { header: 'Curso', value: (m) => m.curso_nome ?? '' },
      { header: 'Método', value: (m) => (m.metodo ? METODO_LABELS[m.metodo as MetodoPagamento] : '') },
      { header: 'Referência', value: (m) => m.referencia ?? '' },
      { header: 'Valor (MZN)', value: (m) => Number(m.valor).toFixed(2).replace('.', ',') },
    ],
    movimentos,
  )
}

/**
 * Escolha do relatório: extracto do dia ou resumo do mês, em PDF (impressão)
 * ou CSV. Os números vêm da mesma agregação usada no ecrã.
 */
export default function RelatorioFinanceiroModal({
  dia,
  movimentos,
  fecho,
  onClose,
}: {
  dia: string
  movimentos: MovimentoFinanceiro[]
  fecho: FechoDia | null
  onClose: () => void
}) {
  useEscapeKey(onClose)
  const [aGerar, setAGerar] = useState<'dia' | 'mes' | null>(null)

  const doDia = useMemo(() => movimentos.filter((m) => m.data === dia), [movimentos, dia])
  const doMes = useMemo(
    () => movimentos.filter((m) => m.data.slice(0, 7) === dia.slice(0, 7)),
    [movimentos, dia],
  )
  const resumoDia = useMemo(() => resumirMovimentos(doDia), [doDia])
  const resumoMes = useMemo(() => resumirMovimentos(doMes), [doMes])

  const serieMes = useMemo(() => {
    const comMovimento = [...new Set(doMes.map((m) => m.data))].sort()
    return serieDiaria(doMes, comMovimento)
  }, [doMes])

  const emitirDia = async () => {
    setAGerar('dia')
    try {
      await abrirRelatorioFinanceiro({
        titulo: 'Extracto diário de caixa',
        periodo: diaLongo(dia),
        movimentos: doDia,
        fecho,
      })
    } finally {
      setAGerar(null)
    }
  }

  const emitirMes = async () => {
    setAGerar('mes')
    try {
      await abrirRelatorioFinanceiro({
        titulo: 'Resumo mensal de caixa',
        periodo: mesLongo(dia),
        movimentos: doMes,
        serie: serieMes,
      })
    } finally {
      setAGerar(null)
    }
  }

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-lg font-semibold text-ink">Relatório financeiro</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              O PDF abre no diálogo de impressão — escolha «Guardar como PDF».
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost -mr-2 -mt-1 px-2 py-1 text-lg" aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="mt-5 rounded-md border border-line p-4">
          <p className="label-section">Extracto do dia</p>
          <p className="mt-1 text-[13px] text-ink-muted">{diaLongo(dia)}</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] text-ink-faint">Bruto</p>
              <p className="mt-0.5 tnum text-[15px] text-ink">{fmtMzn(resumoDia.bruto)}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink-faint">Despesas</p>
              <p className="mt-0.5 tnum text-[15px] text-ink">{fmtMzn(resumoDia.despesas)}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink-faint">Líquido</p>
              <p className={`mt-0.5 tnum text-[15px] ${resumoDia.liquido < 0 ? 'text-danger' : 'text-ink'}`}>
                {fmtMzn(resumoDia.liquido)}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-ink-faint">
            {resumoDia.operacoes} movimento(s) · {fecho ? 'dia fechado' : 'dia ainda não fechado'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void emitirDia()} disabled={aGerar !== null} className="btn-primary px-3 py-1.5 text-xs">
              {aGerar === 'dia' ? 'A preparar...' : 'Imprimir / Guardar PDF'}
            </button>
            <button
              onClick={() => csvMovimentos(doDia, `financas_dia_${dia}`)}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              Descarregar CSV
            </button>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-line p-4">
          <p className="label-section">Resumo do mês</p>
          <p className="mt-1 text-[13px] text-ink-muted">{mesLongo(dia)}</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] text-ink-faint">Bruto</p>
              <p className="mt-0.5 tnum text-[15px] text-ink">{fmtMzn(resumoMes.bruto)}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink-faint">Despesas</p>
              <p className="mt-0.5 tnum text-[15px] text-ink">{fmtMzn(resumoMes.despesas)}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink-faint">Líquido</p>
              <p className={`mt-0.5 tnum text-[15px] ${resumoMes.liquido < 0 ? 'text-danger' : 'text-ink'}`}>
                {fmtMzn(resumoMes.liquido)}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-ink-faint">{resumoMes.operacoes} movimento(s) no mês</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void emitirMes()} disabled={aGerar !== null} className="btn-secondary px-3 py-1.5 text-xs">
              {aGerar === 'mes' ? 'A preparar...' : 'Imprimir / Guardar PDF'}
            </button>
            <button
              onClick={() => csvMovimentos(doMes, `financas_mes_${dia.slice(0, 7)}`)}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              Descarregar CSV
            </button>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-ink-faint">
          O extracto do dia inclui o estado do fecho e as assinaturas. O resumo do mês inclui o movimento por dia e
          todos os movimentos do mês.
        </p>
      </div>
    </div>,
    document.body,
  )
}
