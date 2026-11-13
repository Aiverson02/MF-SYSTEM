import type { LinhaResumo, PontoSerie } from '../lib/financas'
import { diaCurto, fmtMzn, fmtMznCurto, fmtPct } from '../lib/financas'

const CORES_MEIO: Record<string, string> = {
  fisico: 'bg-accent',
  digital: 'bg-accent/60',
  outro: 'bg-line-strong',
}

// ---------------------------------------------------------------------------
// Últimos dias: entradas, despesas e linha do líquido
// ---------------------------------------------------------------------------

export function GraficoDias({ pontos }: { pontos: PontoSerie[] }) {
  const largura = 720
  const altura = 210
  const esquerda = 52
  const direita = 10
  const topo = 18
  const base = 30
  const larguraPlot = largura - esquerda - direita
  const alturaPlot = altura - topo - base

  const valores = pontos.flatMap((p) => [p.bruto, p.despesas, p.liquido, 0])
  const max = Math.max(...valores, 1)
  const min = Math.min(...valores, 0)
  const amplitude = max - min || 1
  const y = (v: number) => topo + ((max - v) / amplitude) * alturaPlot
  const grupo = larguraPlot / Math.max(pontos.length, 1)
  const barra = Math.min(11, grupo * 0.28)

  const yZero = y(0)
  const grade = [max, (max + min) / 2, min]

  return (
    <svg
      viewBox={`0 0 ${largura} ${altura}`}
      className="mt-2 w-full"
      role="img"
      aria-label={`Movimento dos últimos ${pontos.length} dias: entradas, despesas e líquido por dia.`}
    >
      {grade.map((v, i) => (
        <g key={i}>
          <line
            x1={esquerda}
            x2={largura - direita}
            y1={y(v)}
            y2={y(v)}
            className="text-line"
            stroke="currentColor"
            strokeWidth={i === 2 ? 1 : 0.5}
            strokeDasharray={i === 2 ? undefined : '2 4'}
          />
          <text
            x={esquerda - 6}
            y={y(v) + 3}
            textAnchor="end"
            className="text-ink-faint font-mono"
            fill="currentColor"
            fontSize="8.5"
          >
            {fmtMznCurto(v)}
          </text>
        </g>
      ))}

      {pontos.map((p, i) => {
        const cx = esquerda + grupo * (i + 0.5)
        const mostrarRotulo = pontos.length <= 14 || i % 2 === 0
        return (
          <g key={p.data}>
            <rect
              x={cx - barra - 1}
              y={y(p.bruto)}
              width={barra}
              height={Math.max(y(0) - y(p.bruto), p.bruto > 0 ? 1 : 0)}
              rx="1.5"
              className="text-accent"
              fill="currentColor"
            >
              <title>{`${diaCurto(p.data)} — entradas ${fmtMzn(p.bruto)}`}</title>
            </rect>
            <rect
              x={cx + 1}
              y={y(p.despesas)}
              width={barra}
              height={Math.max(y(0) - y(p.despesas), p.despesas > 0 ? 1 : 0)}
              rx="1.5"
              className="text-ink-faint"
              fill="currentColor"
            >
              <title>{`${diaCurto(p.data)} — despesas ${fmtMzn(p.despesas)}`}</title>
            </rect>
            {mostrarRotulo && (
              <text
                x={cx}
                y={altura - 10}
                textAnchor="middle"
                className="text-ink-faint font-mono"
                fill="currentColor"
                fontSize="8.5"
              >
                {p.data.slice(8)}
              </text>
            )}
          </g>
        )
      })}

      <polyline
        points={pontos.map((p, i) => `${esquerda + grupo * (i + 0.5)},${y(p.liquido)}`).join(' ')}
        fill="none"
        className="text-ink"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {pontos.map((p, i) => (
        <circle
          key={`ponto-${p.data}`}
          cx={esquerda + grupo * (i + 0.5)}
          cy={y(p.liquido)}
          r="1.9"
          className="text-ink"
          fill="currentColor"
        >
          <title>{`${diaCurto(p.data)} — líquido ${fmtMzn(p.liquido)}`}</title>
        </circle>
      ))}

      <line
        x1={esquerda}
        x2={largura - direita}
        y1={yZero}
        y2={yZero}
        className="text-line-strong"
        stroke="currentColor"
        strokeWidth="0.8"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Composição: lista com barra por rubrica
// ---------------------------------------------------------------------------

export function ListaComposicao({
  linhas,
  vazio,
  tom = 'accent',
}: {
  linhas: LinhaResumo[]
  vazio: string
  /** 'accent' para entradas; 'neutro' para despesas. */
  tom?: 'accent' | 'neutro'
}) {
  if (linhas.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-ink-faint">{vazio}</p>
  }
  return (
    <ul className="divide-y divide-line">
      {linhas.map((l) => (
        <li key={l.chave} className="px-4 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[13px] text-ink">{l.label}</span>
            <span className="shrink-0 font-mono text-[11px] text-ink-muted">
              {fmtMzn(l.valor)} · {fmtPct(l.parte)}
            </span>
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-raised">
            <div
              className={`h-full rounded-full ${tom === 'accent' ? 'bg-accent' : 'bg-ink-faint'}`}
              style={{ width: `${Math.min(l.parte * 100, 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Físico vs digital
// ---------------------------------------------------------------------------

export function BarraMeios({ linhas, total }: { linhas: LinhaResumo[]; total: number }) {
  const presentes = linhas.filter((l) => l.valor > 0)
  if (total <= 0 || presentes.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-ink-faint">Sem entradas registadas neste dia.</p>
  }
  return (
    <div className="px-4 py-3">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-raised" aria-hidden>
        {presentes.map((l) => (
          <div key={l.chave} className={CORES_MEIO[l.chave] ?? 'bg-line-strong'} style={{ width: `${l.parte * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 space-y-2">
        {presentes.map((l) => (
          <li key={l.chave} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="flex items-center gap-2 text-ink-muted">
              <span className={`dot ${CORES_MEIO[l.chave] ?? 'bg-line-strong'}`} aria-hidden />
              {l.label}
              <span className="font-mono text-[10px] text-ink-faint">{l.quantidade} op.</span>
            </span>
            <span className="tnum text-ink">
              {fmtMzn(l.valor)} <span className="font-mono text-[10px] text-ink-faint">{fmtPct(l.parte)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
