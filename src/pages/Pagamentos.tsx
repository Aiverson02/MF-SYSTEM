import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { CobrancaAluno, EstadoPagamento, MetodoPagamento, Pagamento, PosConclusao } from '../types/database'
import { ESTADO_PAGAMENTO_LABELS, ITEM_POS_LABELS, METODO_LABELS, mesLabel } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { EmptyState, ErrorMessage, LoadingBlock, PageHeader } from '../components/ui'
import { confirmarAcao, showError, showSuccess } from '../lib/alerts'
import { pushToast } from '../components/ToastHost'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { imprimirRecibo, imprimirReciboCobranca, imprimirReciboPos } from '../lib/recibo'
import { useFinancas } from '../hooks/useFinancas'
import { useIsAdmin } from '../hooks/usePerfil'

/** 'YYYY-MM-01' para o mês actual */
const mesActual = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** 'YYYY-MM-01' do mês seguinte — limite superior (exclusive) do mês pedido. */
const mesSeguinte = (mes: string) => {
  const d = new Date(`${mes}T12:00:00`)
  d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const fmtMzn = (v: number) =>
  new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', maximumFractionDigits: 0 }).format(v)

// ---------------------------------------------------------------------------
// Modal de pagamento: regista/altera um pagamento
// ---------------------------------------------------------------------------

interface PagamentoModalProps {
  pagamento: Pagamento
  onClose: () => void
  onDone: () => void
}

function PagamentoModal({ pagamento, onClose, onDone }: PagamentoModalProps) {
  useEscapeKey(onClose)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    estado: pagamento.estado,
    valor: String(pagamento.valor ?? ''),
    data_pagamento: pagamento.data_pagamento ?? new Date().toISOString().slice(0, 10),
    metodo: (pagamento.metodo ?? 'numerario') as MetodoPagamento,
    referencia: pagamento.referencia ?? '',
    observacoes: pagamento.observacoes ?? '',
  })
  const pago = form.estado === 'pago'
  const aluno = pagamento.alunos_matriculados

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const payload: Partial<Pagamento> = {
      estado: form.estado,
      valor: Number(form.valor) || 0,
      data_pagamento: pago ? form.data_pagamento || null : null,
      metodo: pago ? form.metodo : null,
      referencia: pago ? form.referencia.trim() || null : null,
      observacoes: form.observacoes.trim() || null,
    }
    const { error } = await supabase.from('pagamentos').update(payload).eq('id', pagamento.id)
    setLoading(false)
    if (error) {
      showError(error.message)
      return
    }
    showSuccess(pago ? 'Pagamento registado.' : 'Cobrança actualizada.')
    if (pago && pagamento.estado !== 'pago') {
      // Novo pagamento: imprimir recibo automaticamente após fechar o modal
      onDone()
      onClose()
      setTimeout(
        () =>
          imprimirRecibo({
            ...pagamento,
            estado: 'pago',
            valor: Number(form.valor) || pagamento.valor,
            data_pagamento: form.data_pagamento || null,
            metodo: form.metodo,
            referencia: form.referencia.trim() || null,
          } as Pagamento),
        250,
      )
      return
    }
    onDone()
    onClose()
  }

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <form
        onSubmit={guardar}
        className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-lg"
      >
        <h2 className="font-serif text-lg font-semibold text-ink">Registar Pagamento</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          {aluno?.inscricoes?.nome_completo ?? 'Aluno'}
          <span className="ml-2 font-mono text-xs text-ink-faint">{aluno?.numero_estudante}</span>
          <span className="mt-0.5 block text-xs text-ink-faint">
            {mesLabel(pagamento.mes_referencia)} · {fmtMzn(pagamento.valor)}
          </span>
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="label-section mb-1 block">Estado</label>
            <select
              className="input w-full"
              value={form.estado}
              onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value as EstadoPagamento }))}
            >
              {(['pendente', 'pago', 'isento', 'cancelado'] as EstadoPagamento[]).map((s) => (
                <option key={s} value={s}>
                  {ESTADO_PAGAMENTO_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-section mb-1 block">Valor (MZN)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input w-full tnum"
              value={form.valor}
              onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
              required
            />
          </div>

          {pago && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-section mb-1 block">Data do pagamento</label>
                  <input
                    type="date"
                    className="input w-full"
                    value={form.data_pagamento}
                    onChange={(e) => setForm((f) => ({ ...f, data_pagamento: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="label-section mb-1 block">Método</label>
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
              </div>
              <div>
                <label className="label-section mb-1 block">Referência / recibo</label>
                <input
                  className="input w-full"
                  placeholder="Nº do recibo ou transacção"
                  value={form.referencia}
                  onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))}
                />
              </div>
            </>
          )}

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

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            Guardar
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

// ---------------------------------------------------------------------------
// Gate de finanças: ecrã de desbloqueio por código
// ---------------------------------------------------------------------------

function GateFinancas({
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

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cobranças avulsas (026): testes, material, exame... atribuídas nas
// Configurações. Pendentes aqui, com "registar pago" e recibo — tal como as
// mensalidades. Não seguem o filtro de mês: não têm mês de referência.
// ---------------------------------------------------------------------------

function SecaoCobrancasAlunos() {
  const fetcher = useCallback(async () => {
    const { data, error } = await supabase
      .from('cobrancas_alunos')
      .select(
        '*, cobrancas(nome, descricao), alunos_matriculados(numero_estudante, inscricoes(nome_completo), turmas(nome_turma))',
      )
      .order('created_at', { ascending: false })
    return { data: (data ?? []) as CobrancaAluno[], error }
  }, [])
  const { data: cobrancasAlunos, loading, error, reload } = useAsyncData<CobrancaAluno[]>(fetcher, [])

  const [estadoFiltro, setEstadoFiltro] = useState<'todos' | EstadoPagamento>('todos')
  const [pesquisa, setPesquisa] = useState('')

  const kpis = useMemo(() => {
    const pendentes = (cobrancasAlunos ?? []).filter((c) => c.estado === 'pendente')
    const pagos = (cobrancasAlunos ?? []).filter((c) => c.estado === 'pago')
    return {
      nPendentes: pendentes.length,
      porPagar: pendentes.reduce((s, c) => s + Number(c.valor), 0),
      recebido: pagos.reduce((s, c) => s + Number(c.valor), 0),
    }
  }, [cobrancasAlunos])

  const filtradas = useMemo(() => {
    let base = cobrancasAlunos ?? []
    if (estadoFiltro !== 'todos') base = base.filter((c) => c.estado === estadoFiltro)
    const q = pesquisa.trim().toLowerCase()
    if (q) {
      base = base.filter(
        (c) =>
          (c.alunos_matriculados?.inscricoes?.nome_completo ?? '').toLowerCase().includes(q) ||
          (c.alunos_matriculados?.numero_estudante ?? '').toLowerCase().includes(q) ||
          (c.cobrancas?.nome ?? '').toLowerCase().includes(q),
      )
    }
    return base
  }, [cobrancasAlunos, estadoFiltro, pesquisa])

  const alterarEstado = async (
    c: CobrancaAluno,
    estado: EstadoPagamento,
    confirmacao?: { titulo: string; mensagem: string; perigo?: boolean },
  ) => {
    if (confirmacao) {
      const ok = await confirmarAcao({
        title: confirmacao.titulo,
        message: confirmacao.mensagem,
        confirmLabel: 'Confirmar',
        danger: confirmacao.perigo ?? false,
      })
      if (!ok) return
    }
    const patch: { estado: EstadoPagamento; data_pagamento: string | null; metodo: MetodoPagamento | null } =
      estado === 'pago'
        ? { estado, data_pagamento: new Date().toISOString().slice(0, 10), metodo: 'numerario' }
        : { estado, data_pagamento: null, metodo: null }
    const { error: err } = await supabase.from('cobrancas_alunos').update(patch).eq('id', c.id)
    if (err) {
      showError(err.message)
      return
    }
    pushToast(
      estado === 'pago'
        ? 'Pagamento registado. Método: numerário — edite a linha para outro método.'
        : estado === 'isento'
          ? 'Cobrança isenta.'
          : 'Cobrança cancelada — deixa de contar para o devido.',
      'sucesso',
    )
    void reload()
  }

  return (
    <div className="cell mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="label-section">Cobranças avulsas</p>
          <p className="text-[11px] text-ink-faint">
            Testes, material, exame... — criadas em{' '}
            <Link to="/admin/configuracoes" className="text-accent hover:text-accent-strong">
              Configurações
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-ink-faint">
          <span>
            {kpis.nPendentes} pendente(s) · {fmtMzn(kpis.porPagar)} por pagar
          </span>
          <span className="text-ok">{fmtMzn(kpis.recebido)} recebido</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <div className="flex w-fit gap-0.5 rounded-md border border-line p-0.5">
          {(['todos', 'pendente', 'pago', 'isento', 'cancelado'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setEstadoFiltro(f)}
              className={`rounded px-3 py-1 text-[13px] font-medium ${
                estadoFiltro === f ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {f === 'todos' ? 'Todos' : ESTADO_PAGAMENTO_LABELS[f]}
            </button>
          ))}
        </div>
        <input
          value={pesquisa}
          onChange={(e) => setPesquisa(e.target.value)}
          className="input ml-auto w-64"
          placeholder="Pesquisar aluno ou cobrança..."
        />
      </div>

      <div className="p-4">
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorMessage message={error} onRetry={() => void reload()} />
        ) : (cobrancasAlunos ?? []).length === 0 ? (
          <EmptyState
            message="Sem cobranças avulsas. Configure os tipos em Configurações e aplique-os aos alunos."
            icon="🧾"
          />
        ) : filtradas.length === 0 ? (
          <EmptyState message="Nenhuma cobrança com estes filtros." icon="🔍" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Aluno</th>
                  <th className="px-4 py-2.5 font-medium">Cobrança</th>
                  <th className="px-4 py-2.5 font-medium">Valor</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtradas.map((c) => {
                  const a = c.alunos_matriculados
                  return (
                    <tr key={c.id} className="hover:bg-canvas">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink">{a?.inscricoes?.nome_completo ?? '—'}</p>
                        <p className="font-mono text-[11px] text-ink-faint">{a?.numero_estudante}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-ink">{c.cobrancas?.nome ?? '—'}</p>
                        {c.cobrancas?.descricao && (
                          <p className="text-[11px] text-ink-faint">{c.cobrancas.descricao}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 tnum text-ink">{fmtMzn(Number(c.valor))}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2 text-[13px]">
                          <span
                            className={`dot ${
                              c.estado === 'pago'
                                ? 'bg-ok'
                                : c.estado === 'pendente'
                                  ? 'bg-warn'
                                  : c.estado === 'isento'
                                    ? 'bg-accent'
                                    : 'bg-ink-faint'
                            }`}
                            aria-hidden
                          />
                          {ESTADO_PAGAMENTO_LABELS[c.estado]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          {c.estado === 'pendente' && (
                            <>
                              <button
                                onClick={() => void alterarEstado(c, 'pago')}
                                className="btn-primary px-2.5 py-1 text-xs"
                              >
                                Registar pago
                              </button>
                              <button
                                onClick={() =>
                                  void alterarEstado(c, 'isento', {
                                    titulo: 'Isentar cobrança',
                                    mensagem: `Isentar "${c.cobrancas?.nome ?? ''}" de ${a?.inscricoes?.nome_completo ?? 'aluno'} (${fmtMzn(Number(c.valor))})?`,
                                  })
                                }
                                className="btn-secondary px-2.5 py-1 text-xs"
                              >
                                Isentar
                              </button>
                              <button
                                onClick={() =>
                                  void alterarEstado(c, 'cancelado', {
                                    titulo: 'Cancelar cobrança',
                                    mensagem: `Cancelar "${c.cobrancas?.nome ?? ''}" de ${a?.inscricoes?.nome_completo ?? 'aluno'}?\n\nDeixa de contar; pode aplicar a cobrança de novo.`,
                                    perigo: true,
                                  })
                                }
                                className="btn-danger px-2.5 py-1 text-xs"
                              >
                                Cancelar
                              </button>
                            </>
                          )}
                          {c.estado === 'pago' && (
                            <button
                              onClick={() => void imprimirReciboCobranca(c)}
                              className="btn-secondary px-2.5 py-1 text-xs"
                            >
                              Recibo
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Pagamentos() {
  const isAdmin = useIsAdmin()
  const { desbloqueado, erro: erroGate, aValidar, desbloquear } = useFinancas()
  const [mes, setMes] = useState(mesActual())
  const [estadoFiltro, setEstadoFiltro] = useState<'todos' | EstadoPagamento>('todos')
  const [pesquisa, setPesquisa] = useState('')
  const [modal, setModal] = useState<Pagamento | null>(null)
  const [gerando, setGerando] = useState(false)

  const fetcher = useCallback(async () => {
    const { data, error } = await supabase
      .from('pagamentos')
      .select(
        '*, alunos_matriculados(numero_estudante, inscricoes(nome_completo), turmas(nome_turma, turno))',
      )
      .eq('mes_referencia', mes)
      .order('created_at')
    return { data: (data ?? []) as Pagamento[], error }
  }, [mes])

  const { data: pagamentos, loading, error, reload } = useAsyncData<Pagamento[]>(fetcher, [mes])

  // Certificados e faixas pagos neste mês. Vivem noutra tabela (não são
  // mensalidades, e cada aluno só tem uma mensalidade por mês), por isso não
  // entram na lista acima — mas têm de contar nos valores do mês.
  const posFetcher = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('pos_conclusao')
      .select(
        'id, item, valor, pago, estado, data_pagamento, criado_em, alunos_matriculados(numero_estudante, inscricoes(nome_completo), turmas(nome_turma))',
      )
      .eq('pago', true)
      .gte('data_pagamento', mes)
      .lt('data_pagamento', mesSeguinte(mes))
      .order('data_pagamento', { ascending: false })
    return { data: (data ?? []) as unknown as PosConclusao[], error: err }
  }, [mes])

  const { data: posPagos } = useAsyncData<PosConclusao[]>(posFetcher, [mes])

  const posKpis = useMemo(() => {
    const lista = posPagos ?? []
    return {
      quantidade: lista.length,
      recebido: lista.reduce((s, i) => s + Number(i.valor), 0),
    }
  }, [posPagos])

  // KPIs do mês
  const kpis = useMemo(() => {
    const activos = (pagamentos ?? []).filter((p) => p.estado !== 'cancelado')
    const esperado = activos.reduce((s, p) => s + Number(p.valor), 0)
    const recebido = activos
      .filter((p) => p.estado === 'pago')
      .reduce((s, p) => s + Number(p.valor), 0)
    const pagos = activos.filter((p) => p.estado === 'pago').length
    const pendentes = activos.filter((p) => p.estado === 'pendente').length
    return {
      esperado,
      recebido,
      emFalta: esperado - recebido,
      taxa: esperado > 0 ? Math.round((recebido / esperado) * 100) : 100,
      pagos,
      pendentes,
      total: activos.length,
    }
  }, [pagamentos])

  const filtradas = useMemo(() => {
    let base = pagamentos ?? []
    if (estadoFiltro !== 'todos') base = base.filter((p) => p.estado === estadoFiltro)
    const q = pesquisa.trim().toLowerCase()
    if (q) {
      base = base.filter((p) => {
        const a = p.alunos_matriculados
        return (
          (a?.inscricoes?.nome_completo ?? '').toLowerCase().includes(q) ||
          (a?.numero_estudante ?? '').toLowerCase().includes(q)
        )
      })
    }
    return base
  }, [pagamentos, estadoFiltro, pesquisa])

  const gerarCobrancas = async () => {
    const ok = await confirmarAcao({
      title: 'Gerar cobranças',
      message: `Gerar cobranças de ${mesLabel(mes)} para todos os alunos activos que ainda não têm cobrança neste mês?`,
      confirmLabel: 'Gerar',
    })
    if (!ok) return
    setGerando(true)
    const { data, error } = await supabase.rpc('gerar_cobrancas_mes', { p_mes: mes })
    setGerando(false)
    if (error) {
      showError(error.message)
      return
    }
    const r = (data as { gerados: number; mensagem: string }[] | null)?.[0]
    showSuccess(r?.mensagem ?? 'Cobranças geradas.')
    void reload()
  }

  const marcarPago = async (p: Pagamento) => {
    const { error } = await supabase
      .from('pagamentos')
      .update({
        estado: 'pago',
        data_pagamento: new Date().toISOString().slice(0, 10),
        metodo: 'numerario',
      })
      .eq('id', p.id)
    if (error) {
      showError(error.message)
      return
    }
    pushToast('Pagamento registado. Método: numerário (edite para alterar).', 'sucesso')
    void reload()
  }

  return (
    <>
      <PageHeader
        title="Pagamentos"
        subtitle="Mensalidades por aluno — cobrança, registo e acompanhamento"
        actions={
          isAdmin ? (
            <button onClick={() => void gerarCobrancas()} disabled={gerando} className="btn-primary">
              {gerando ? 'A gerar...' : 'Gerar cobranças do mês'}
            </button>
          ) : undefined
        }
      />

      {/* Gate: código de finanças obrigatório */}
      {!desbloqueado ? (
        <GateFinancas erro={erroGate} aValidar={aValidar} onDesbloquear={(c) => void desbloquear(c)} />
      ) : (
      <>
      {/* Selector de mês + filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="month"
          className="input w-fit"
          value={mes.slice(0, 7)}
          onChange={(e) => setMes(`${e.target.value}-01`)}
        />
        <div className="flex w-fit gap-0.5 rounded-md border border-line p-0.5">
          {(['todos', 'pendente', 'pago', 'isento'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setEstadoFiltro(f)}
              className={`rounded px-3 py-1 text-[13px] font-medium ${
                estadoFiltro === f ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {f === 'todos' ? 'Todos' : ESTADO_PAGAMENTO_LABELS[f]}
            </button>
          ))}
        </div>
        <input
          value={pesquisa}
          onChange={(e) => setPesquisa(e.target.value)}
          className="input ml-auto w-64"
          placeholder="Pesquisar aluno ou nº..."
        />
      </div>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorMessage message={error} onRetry={() => void reload()} />
      ) : (
        <>
          {/* Faixa de KPIs financeiros */}
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="cell px-4 py-3">
              <p className="label-section">Esperado</p>
              <p className="mt-1 font-serif text-[22px] leading-none tnum text-ink">{fmtMzn(kpis.esperado)}</p>
            </div>
            <div className="cell px-4 py-3">
              <p className="label-section">Recebido</p>
              <p className="mt-1 font-serif text-[22px] leading-none tnum text-ok">{fmtMzn(kpis.recebido)}</p>
            </div>
            <div className="cell px-4 py-3">
              <p className="label-section">Em falta</p>
              <p className={`mt-1 font-serif text-[22px] leading-none tnum ${kpis.emFalta > 0 ? 'text-warn' : 'text-ink'}`}>
                {fmtMzn(kpis.emFalta)}
              </p>
            </div>
            <div className="cell px-4 py-3">
              <p className="label-section">Taxa de cobrança</p>
              <p className="mt-1 font-serif text-[22px] leading-none tnum text-ink">{kpis.taxa}%</p>
              <div className="mt-2 h-1 rounded-full bg-raised">
                <div
                  className={`h-full rounded-full ${kpis.taxa >= 80 ? 'bg-ok' : kpis.taxa >= 50 ? 'bg-warn' : 'bg-danger'}`}
                  style={{ width: `${kpis.taxa}%` }}
                />
              </div>
            </div>
            <div className="cell px-4 py-3">
              <p className="label-section">Certificados e faixas</p>
              <p className="mt-1 font-serif text-[22px] leading-none tnum text-ok">{fmtMzn(posKpis.recebido)}</p>
              <p className="mt-1 text-[11px] text-ink-faint">
                {posKpis.quantidade === 0
                  ? 'Nada pago neste mês'
                  : `${posKpis.quantidade} item(ns) de pós-conclusão pago(s) em ${mesLabel(mes)}`}
              </p>
            </div>
          </div>

          <div className="cell">
            {filtradas.length === 0 ? (
              <EmptyState
                message={
                  (pagamentos ?? []).length === 0
                    ? `Sem cobranças para ${mesLabel(mes)}. Use "Gerar cobranças do mês".`
                    : 'Nenhum registo com estes filtros.'
                }
                icon="💳"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                      <th className="px-4 py-2.5 font-medium">Aluno</th>
                      <th className="px-4 py-2.5 font-medium">Turma</th>
                      <th className="px-4 py-2.5 font-medium">Valor</th>
                      <th className="px-4 py-2.5 font-medium">Estado</th>
                      <th className="px-4 py-2.5 font-medium">Pagamento</th>
                      <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filtradas.map((p) => {
                      const a = p.alunos_matriculados
                      return (
                        <tr key={p.id} className="hover:bg-canvas">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-ink">
                              {a?.inscricoes?.nome_completo ?? '—'}
                            </p>
                            <p className="font-mono text-[11px] text-ink-faint">{a?.numero_estudante}</p>
                          </td>
                          <td className="px-4 py-2.5 text-ink-muted">{a?.turmas?.nome_turma ?? ''}</td>
                          <td className="px-4 py-2.5 tnum text-ink">{fmtMzn(Number(p.valor))}</td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-2 text-[13px]">
                              <span
                                className={`dot ${
                                  p.estado === 'pago'
                                    ? 'bg-ok'
                                    : p.estado === 'pendente'
                                      ? 'bg-warn'
                                      : p.estado === 'isento'
                                        ? 'bg-accent'
                                        : 'bg-ink-faint'
                                }`}
                                aria-hidden
                              />
                              {ESTADO_PAGAMENTO_LABELS[p.estado]}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-ink-muted">
                            {p.estado === 'pago' ? (
                              <>
                                {p.metodo ? METODO_LABELS[p.metodo] : ''}
                                {p.data_pagamento && (
                                  <span className="block font-mono text-[11px] text-ink-faint">
                                    {p.data_pagamento}
                                    {p.referencia ? ` · ${p.referencia}` : ''}
                                  </span>
                                )}
                              </>
                            ) : (
                              ''
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex justify-end gap-2">
                              {p.estado === 'pendente' && (
                                <button onClick={() => void marcarPago(p)} className="btn-primary px-2.5 py-1 text-xs">
                                  Registar pago
                                </button>
                              )}
                              {p.estado === 'pago' && (
                                <button onClick={() => void imprimirRecibo(p)} className="btn-secondary px-2.5 py-1 text-xs">
                                  Recibo
                                </button>
                              )}
                              <button onClick={() => setModal(p)} className="btn-secondary px-2.5 py-1 text-xs">
                                {p.estado === 'pago' ? 'Editar' : 'Detalhes'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="mt-2 text-xs text-ink-faint">
            {filtradas.length} registo(s) · {kpis.pagos} pago(s) · {kpis.pendentes} pendente(s) ·{' '}
            <Link to="/admin/cursos" className="text-accent hover:text-accent-strong">
              configurar valores por curso
            </Link>
          </p>

          {/* Pós-conclusão pagos no mês — com recibo, como as mensalidades */}
          {posPagos !== null && posPagos.length > 0 && (
            <div className="cell mt-3">
              <div className="border-b border-line px-4 py-3">
                <p className="label-section">Certificados e faixas pagos em {mesLabel(mes)}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                      <th className="px-4 py-2.5 font-medium">Aluno</th>
                      <th className="px-4 py-2.5 font-medium">Item</th>
                      <th className="px-4 py-2.5 font-medium">Valor</th>
                      <th className="px-4 py-2.5 font-medium">Pagamento</th>
                      <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {posPagos.map((i) => (
                      <tr key={i.id} className="hover:bg-canvas">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-ink">
                            {i.alunos_matriculados?.inscricoes?.nome_completo ?? '—'}
                          </p>
                          <p className="font-mono text-[11px] text-ink-faint">
                            {i.alunos_matriculados?.numero_estudante}
                          </p>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center rounded bg-raised px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-ink-muted">
                            {ITEM_POS_LABELS[i.item]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 tnum text-ink">{fmtMzn(Number(i.valor))}</td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-ink-faint">{i.data_pagamento ?? ''}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => void imprimirReciboPos(i)}
                            className="btn-secondary px-2.5 py-1 text-xs"
                          >
                            Recibo
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <SecaoCobrancasAlunos />
      </>
      )}

      {modal && <PagamentoModal pagamento={modal} onClose={() => setModal(null)} onDone={() => void reload()} />}
    </>
  )
}
