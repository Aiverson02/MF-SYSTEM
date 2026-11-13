import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { FechoDia, MetodoPagamento, MovimentoFinanceiro } from '../types/database'
import { METODO_LABELS } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { useFinancas } from '../hooks/useFinancas'
import { confirmarAcao, showError, showSuccess } from '../lib/alerts'
import { EmptyState, ErrorMessage, LoadingBlock, PageHeader } from '../components/ui'
import GateFinancas from '../components/GateFinancas'
import DespesaModal from '../components/DespesaModal'
import RegistarRecebimentoModal from '../components/RegistarRecebimentoModal'
import FechoDiaModal from '../components/FechoDiaModal'
import RelatorioFinanceiroModal from '../components/RelatorioFinanceiroModal'
import { BarraMeios, GraficoDias, ListaComposicao } from '../components/FinancasGraficos'
import {
  categoriaLabel,
  diaLongo,
  fimDoMes,
  fmtMzn,
  hojeIso,
  inicioDoMes,
  mesLongo,
  mesReferenciaDe,
  resumirMovimentos,
  serieDiaria,
  somarDias,
  ultimosDias,
  variacao,
} from '../lib/financas'

interface Pendentes {
  mensalidades: { n: number; valor: number }
  cobrancas: { n: number; valor: number }
  pos: { n: number; valor: number }
}

interface DadosFinancas {
  movimentos: MovimentoFinanceiro[]
  fecho: FechoDia | null
  pendentes: Pendentes
}

const somaValores = (linhas: { valor: unknown }[] | null) =>
  (linhas ?? []).reduce((s, l) => s + Number(l.valor), 0)

const capitalizar = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

export default function Financas() {
  const { desbloqueado, erro: erroGate, aValidar, desbloquear } = useFinancas()
  const [dia, setDia] = useState(hojeIso())
  const [despesaAberta, setDespesaAberta] = useState(false)
  const [recebimentoAberto, setRecebimentoAberto] = useState(false)
  const [fechoAberto, setFechoAberto] = useState(false)
  const [relatorioAberto, setRelatorioAberto] = useState(false)

  const fetcher = useCallback(async (): Promise<{
    data: DadosFinancas | null
    error: { message: string } | null
  }> => {
    // A janela cobre o mês (relatório mensal) e os 14 dias do gráfico, que
    // podem começar no mês anterior.
    const inicio14 = somarDias(dia, -13)
    const inicioJanela = inicio14 < inicioDoMes(dia) ? inicio14 : inicioDoMes(dia)
    const fimJanela = fimDoMes(dia)

    const [mov, fecho, pendMens, pendCob, pendPos] = await Promise.all([
      supabase
        .from('vw_movimentos_financeiros')
        .select('*')
        .gte('data', inicioJanela)
        .lte('data', fimJanela)
        .order('data'),
      supabase.from('fechos_dia').select('*').eq('data', dia).maybeSingle(),
      supabase
        .from('pagamentos')
        .select('valor')
        .eq('mes_referencia', mesReferenciaDe(dia))
        .eq('estado', 'pendente'),
      supabase.from('cobrancas_alunos').select('valor').eq('estado', 'pendente'),
      supabase.from('pos_conclusao').select('valor').eq('pago', false).neq('estado', 'entregue'),
    ])

    const erro = mov.error ?? fecho.error ?? pendMens.error ?? pendCob.error ?? pendPos.error
    if (erro) return { data: null, error: { message: erro.message } }

    return {
      data: {
        movimentos: (mov.data ?? []) as MovimentoFinanceiro[],
        fecho: (fecho.data as FechoDia | null) ?? null,
        pendentes: {
          mensalidades: { n: (pendMens.data ?? []).length, valor: somaValores(pendMens.data) },
          cobrancas: { n: (pendCob.data ?? []).length, valor: somaValores(pendCob.data) },
          pos: { n: (pendPos.data ?? []).length, valor: somaValores(pendPos.data) },
        },
      },
      error: null,
    }
  }, [dia])

  const { data, loading, error, reload } = useAsyncData<DadosFinancas>(fetcher, [dia])

  const doDia = useMemo(() => (data?.movimentos ?? []).filter((m) => m.data === dia), [data, dia])
  const resumo = useMemo(() => resumirMovimentos(doDia), [doDia])
  const ontem = useMemo(
    () => resumirMovimentos((data?.movimentos ?? []).filter((m) => m.data === somarDias(dia, -1))),
    [data, dia],
  )
  const serie = useMemo(() => serieDiaria(data?.movimentos ?? [], ultimosDias(dia, 14)), [data, dia])
  const delta = variacao(resumo.liquido, ontem.liquido)

  const fecho = data?.fecho ?? null
  const divergente =
    fecho !== null &&
    (Number(fecho.total_bruto) !== resumo.bruto ||
      Number(fecho.total_despesas) !== resumo.despesas ||
      Number(fecho.total_liquido) !== resumo.liquido)

  const anular = async (m: MovimentoFinanceiro) => {
    const ok = await confirmarAcao({
      title: 'Anular despesa',
      message: `Anular "${m.descricao}" (${fmtMzn(Number(m.valor))})?\n\nA despesa continua no histórico, mas deixa de contar para o caixa.`,
      confirmLabel: 'Anular',
      danger: true,
    })
    if (!ok) return
    const { data: sessao } = await supabase.auth.getUser()
    const { error: err } = await supabase
      .from('despesas')
      .update({
        anulada: true,
        anulada_em: new Date().toISOString(),
        anulada_por: sessao.user?.id ?? null,
      })
      .eq('id', m.origem_id)
    if (err) {
      showError(err.message)
      return
    }
    showSuccess('Despesa anulada.')
    void reload()
  }

  if (!desbloqueado) {
    return (
      <>
        <PageHeader
          title="Finanças"
          subtitle="Caixa do dia — entradas, despesas e total líquido"
        />
        <GateFinancas erro={erroGate} aValidar={aValidar} onDesbloquear={(c) => void desbloquear(c)} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Finanças"
        subtitle="Caixa do dia — entradas, despesas e total líquido"
      />

      {/* Data + acções */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDia(somarDias(dia, -1))}
            className="btn-secondary h-9 w-9 px-0"
            aria-label="Dia anterior"
          >
            ←
          </button>
          <input
            type="date"
            className="input w-fit"
            value={dia}
            max={hojeIso()}
            onChange={(e) => e.target.value && setDia(e.target.value)}
            aria-label="Dia a consultar"
          />
          <button
            onClick={() => setDia(somarDias(dia, 1))}
            disabled={dia >= hojeIso()}
            className="btn-secondary h-9 w-9 px-0"
            aria-label="Dia seguinte"
          >
            →
          </button>
          <button onClick={() => setDia(hojeIso())} className="btn-ghost" disabled={dia === hojeIso()}>
            Hoje
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => setRelatorioAberto(true)} className="btn-secondary">
            Relatório
          </button>
          <button onClick={() => setFechoAberto(true)} className="btn-secondary">
            Fechar o dia
          </button>
          <button onClick={() => setDespesaAberta(true)} className="btn-secondary">
            Registar despesa
          </button>
          <button onClick={() => setRecebimentoAberto(true)} className="btn-primary">
            Registar recebimento
          </button>
        </div>
      </div>

      <p className="mb-3 text-sm text-ink-muted">{capitalizar(diaLongo(dia))}</p>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorMessage message={error} onRetry={() => void reload()} />
      ) : !data ? null : (
        <>
          {/* Caixa do dia + meios */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <section className="cell lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
                <div className="min-w-0">
                  <p className="label-section">Total líquido do dia</p>
                  <p
                    className={`mt-1.5 font-serif text-[40px] leading-none tnum sm:text-[46px] ${
                      resumo.liquido < 0 ? 'text-danger' : 'text-ink'
                    }`}
                  >
                    {fmtMzn(resumo.liquido)}
                  </p>
                  <p className="mt-2.5 text-[13px] text-ink-muted">
                    <span className="tnum text-ink">{fmtMzn(resumo.bruto)}</span> de entradas
                    <span className="px-1.5 text-ink-faint">−</span>
                    <span className="tnum text-ink">{fmtMzn(resumo.despesas)}</span> de despesas
                  </p>
                </div>
                <div className="text-right">
                  <p className="label-section">Face a ontem</p>
                  <p className="mt-1 font-serif text-[19px] leading-none tnum text-ink-muted">
                    {delta === null ? '—' : `${delta > 0 ? '+' : ''}${Math.round(delta * 100)}%`}
                  </p>
                  <p className="mt-1.5 text-[11px] text-ink-faint">ontem: {fmtMzn(ontem.liquido)}</p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 divide-x divide-line border-t border-line">
                <div className="px-5 py-3">
                  <p className="label-section">Entradas</p>
                  <p className="mt-1 tnum text-[15px] text-ink">{fmtMzn(resumo.bruto)}</p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">{resumo.entradas} operação(ões)</p>
                </div>
                <div className="px-5 py-3">
                  <p className="label-section">Despesas</p>
                  <p className="mt-1 tnum text-[15px] text-ink">{fmtMzn(resumo.despesas)}</p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">{resumo.saidas} operação(ões)</p>
                </div>
                <div className="px-5 py-3">
                  <p className="label-section">Movimentos</p>
                  <p className="mt-1 tnum text-[15px] text-ink">{resumo.operacoes}</p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">no dia seleccionado</p>
                </div>
              </div>
            </section>

            <section className="cell">
              <div className="cell-head">
                <p className="label-section">Meios de pagamento</p>
                <span className="font-mono text-[11px] text-ink-faint">{resumo.entradas} entradas</span>
              </div>
              <BarraMeios linhas={resumo.meios} total={resumo.bruto} />
            </section>
          </div>

          {/* Gráficos */}
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <section className="cell pb-1 lg:col-span-2">
              <div className="cell-head">
                <p className="label-section">Últimos 14 dias</p>
                <div className="flex items-center gap-3 text-[10px] text-ink-faint">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-sm bg-accent" aria-hidden />
                    Entradas
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-sm bg-ink-faint" aria-hidden />
                    Despesas
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-px w-3 bg-ink" aria-hidden />
                    Líquido
                  </span>
                </div>
              </div>
              <div className="px-3">
                <GraficoDias pontos={serie} />
              </div>
            </section>

            <section className="cell">
              <div className="cell-head">
                <p className="label-section">Entradas por rubrica</p>
                <span className="font-mono text-[11px] text-ink-faint">{fmtMzn(resumo.bruto)}</span>
              </div>
              <ListaComposicao linhas={resumo.categorias} vazio="Sem entradas neste dia." />
            </section>
          </div>

          {/* Fecho do dia */}
          <div className="cell mt-3 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className={`dot mt-1.5 ${fecho ? 'bg-ok' : 'bg-warn'}`} aria-hidden />
              <div className="min-w-0">
                <p className="text-[13px] text-ink">
                  {fecho
                    ? `Dia fechado às ${new Date(fecho.fechado_em).toLocaleTimeString('pt-PT', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : 'Dia ainda não fechado'}
                </p>
                <p className="truncate text-[11px] text-ink-faint">
                  {fecho?.notas || 'No fim do expediente, feche o dia para guardar os totais do caixa.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {divergente && (
                <p className="text-[11px] text-danger">
                  Os totais mudaram desde o fecho: líquido {fmtMzn(Number(fecho?.total_liquido ?? 0))} →{' '}
                  {fmtMzn(resumo.liquido)}.
                </p>
              )}
              <button onClick={() => setFechoAberto(true)} className="btn-secondary px-3 py-1.5 text-xs">
                {fecho ? 'Actualizar fecho' : 'Fechar o dia'}
              </button>
            </div>
          </div>

          {/* Movimentos */}
          <section className="cell mt-3">
            <div className="cell-head">
              <div>
                <p className="label-section">Movimentos do dia</p>
                <p className="text-[11px] text-ink-faint">
                  Entradas e saídas pela data em que o dinheiro entrou ou saiu.
                </p>
              </div>
              <Link to="/admin/pagamentos" className="text-[12px] font-medium text-accent hover:text-accent-strong">
                Recibos em Pagamentos
              </Link>
            </div>

            {doDia.length === 0 ? (
              <EmptyState
                message="Sem movimentos neste dia. Registe as mensalidades em Pagamentos ou uma despesa aqui."
                icon="🧾"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                      <th className="px-4 py-2.5 font-medium">Descrição</th>
                      <th className="px-4 py-2.5 font-medium">Rubrica</th>
                      <th className="px-4 py-2.5 font-medium">Meio</th>
                      <th className="px-4 py-2.5 text-right font-medium">Valor</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {doDia.map((m) => (
                      <tr key={`${m.origem}-${m.origem_id}`} className="hover:bg-canvas">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-ink">{m.descricao}</p>
                          <p className="text-[11px] text-ink-faint">
                            {m.aluno_nome
                              ? `${m.aluno_nome}${m.curso_nome ? ` · ${m.curso_nome}` : ''}`
                              : 'Despesa da instituição'}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">{categoriaLabel(m)}</td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          {m.metodo ? METODO_LABELS[m.metodo as MetodoPagamento] : '—'}
                          {m.referencia && (
                            <span className="block font-mono text-[10px] text-ink-faint">{m.referencia}</span>
                          )}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right tnum ${
                            m.sentido === 'saida' ? 'text-danger' : 'text-ink'
                          }`}
                        >
                          {m.sentido === 'saida' ? '−' : '+'} {fmtMzn(Number(m.valor))}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {m.origem === 'despesa' && (
                            <button
                              onClick={() => void anular(m)}
                              className="btn-ghost px-2 py-1 text-[11px] text-danger"
                            >
                              Anular
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Despesas por rubrica + por receber */}
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <section className="cell">
              <div className="cell-head">
                <p className="label-section">Despesas do dia por rubrica</p>
                <span className="font-mono text-[11px] text-ink-faint">{fmtMzn(resumo.despesas)}</span>
              </div>
              <ListaComposicao
                linhas={resumo.despesasPorCategoria}
                vazio="Sem despesas neste dia."
                tom="neutro"
              />
            </section>

            <section className="cell">
              <div className="cell-head">
                <p className="label-section">Por receber · {mesLongo(dia)}</p>
                <Link
                  to="/admin/pagamentos"
                  className="text-[12px] font-medium text-accent hover:text-accent-strong"
                >
                  Ver Pagamentos
                </Link>
              </div>
              <ul className="divide-y divide-line">
                {(
                  [
                    ['Mensalidades pendentes', data.pendentes.mensalidades],
                    ['Cobranças pendentes', data.pendentes.cobrancas],
                    ['Certificados e faixas por pagar', data.pendentes.pos],
                  ] as [string, { n: number; valor: number }][]
                ).map(([label, p]) => (
                  <li key={label} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-[13px]">
                    <span className="text-ink-muted">
                      {label} <span className="font-mono text-[10px] text-ink-faint">{p.n}</span>
                    </span>
                    <span className="tnum text-ink">{fmtMzn(p.valor)}</span>
                  </li>
                ))}
              </ul>
              <p className="px-4 py-2 text-[11px] text-ink-faint">
                Valores pendentes não entram no total do dia; só o dinheiro recebido conta para o caixa.
              </p>
            </section>
          </div>
        </>
      )}

      {despesaAberta && (
        <DespesaModal data={dia} onClose={() => setDespesaAberta(false)} onDone={() => void reload()} />
      )}
      {recebimentoAberto && (
        <RegistarRecebimentoModal
          dia={dia}
          onClose={() => setRecebimentoAberto(false)}
          onDone={() => void reload()}
        />
      )}
      {fechoAberto && (
        <FechoDiaModal
          data={dia}
          bruto={resumo.bruto}
          despesas={resumo.despesas}
          liquido={resumo.liquido}
          fecho={fecho}
          onClose={() => setFechoAberto(false)}
          onDone={() => void reload()}
        />
      )}
      {relatorioAberto && (
        <RelatorioFinanceiroModal
          dia={dia}
          movimentos={data?.movimentos ?? []}
          fecho={fecho}
          onClose={() => setRelatorioAberto(false)}
        />
      )}
    </>
  )
}
