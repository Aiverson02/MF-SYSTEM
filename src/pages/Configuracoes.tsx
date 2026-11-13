import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Cobranca, CategoriaReceita, ConfigInstituicao, ConfigPagamento, Curso } from '../types/database'
import { CATEGORIA_RECEITA_LABELS } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { NOME_INSTITUICAO_DEFAULT } from '../hooks/useInstituicao'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { Badge, ErrorMessage, LoadingBlock, PageHeader, Spinner } from '../components/ui'
import { confirmarAcao, showError, showSuccess } from '../lib/alerts'
import AdminGate from '../components/AdminGate'

const BUCKET = 'logotipos'

interface FormState {
  nome: string
  telefone: string
  email: string
  endereco: string
  logo_url: string | null
  novo_codigo_financas: string
  valor_certificado: string
  valor_faixa: string
}

function ConfigForm({ inicial }: { inicial: ConfigInstituicao }) {
  const [form, setForm] = useState<FormState>({
    nome: inicial.nome,
    telefone: inicial.telefone ?? '',
    email: inicial.email ?? '',
    endereco: inicial.endereco ?? '',
    logo_url: inicial.logo_url,
    novo_codigo_financas: '',
    valor_certificado: String(inicial.valor_certificado ?? 350),
    valor_faixa: String(inicial.valor_faixa ?? 500),
  })
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setForm({
      nome: inicial.nome,
      telefone: inicial.telefone ?? '',
      email: inicial.email ?? '',
      endereco: inicial.endereco ?? '',
      logo_url: inicial.logo_url,
      novo_codigo_financas: '',
      valor_certificado: String(inicial.valor_certificado ?? 350),
      valor_faixa: String(inicial.valor_faixa ?? 500),
    })
  }, [inicial])

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const original: FormState = {
    nome: inicial.nome,
    telefone: inicial.telefone ?? '',
    email: inicial.email ?? '',
    endereco: inicial.endereco ?? '',
    logo_url: inicial.logo_url,
    novo_codigo_financas: '',
    valor_certificado: String(inicial.valor_certificado ?? 350),
    valor_faixa: String(inicial.valor_faixa ?? 500),
  }
  const mudou = JSON.stringify(form) !== JSON.stringify(original)

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.nome.trim()) {
      setErro('O nome da instituição não pode ficar vazio.')
      return
    }
    setErro(null)
    setLoading(true)
    const { error } = await supabase.from('config_instituicao').upsert({
      id: 1,
      nome: form.nome.trim(),
      telefone: form.telefone.trim() || null,
      email: form.email.trim() || null,
      endereco: form.endereco.trim() || null,
      logo_url: form.logo_url,
      valor_certificado: Number(form.valor_certificado) || 0,
      valor_faixa: Number(form.valor_faixa) || 0,
      updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    setLoading(false)
    if (error) {
      setErro(error.message)
      return
    }
    // Código de finanças: guardado com hash no servidor, apenas via RPC admin.
    const novoCodigo = form.novo_codigo_financas.trim()
    if (novoCodigo) {
      if (novoCodigo.length < 4) {
        setErro('O novo código de finanças deve ter pelo menos 4 caracteres.')
        return
      }
      const { data: rCod, error: errCod } = await supabase.rpc('definir_codigo_financas', { p_codigo: novoCodigo })
      const rc = (rCod as { sucesso: boolean; mensagem: string }[] | null)?.[0]
      if (errCod || !rc?.sucesso) {
        setErro(rc?.mensagem ?? errCod?.message ?? 'Erro ao definir o código de finanças.')
        return
      }
      setForm((f) => ({ ...f, novo_codigo_financas: '' }))
    }
    showSuccess('Configurações guardadas.')
  }

  const escolherLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErro('O logotipo deve ser uma imagem (PNG, JPG, WebP ou SVG).')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setErro('O logotipo deve ter no máximo 2MB.')
      return
    }
    setErro(null)
    setUploading(true)
    const ext = file.name.split('.').pop() ?? 'png'
    const path = `instituicao/logo-${Date.now()}.${ext}`
    const { error: errUp } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    })
    if (errUp) {
      setUploading(false)
      setErro(errUp.message)
      return
    }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
    setUploading(false)
    setForm((f) => ({ ...f, logo_url: pub.publicUrl }))
    showSuccess('Logotipo carregado. Clique em Guardar para aplicar.')
  }

  const removerLogo = () => {
    setForm((f) => ({ ...f, logo_url: null }))
  }

  return (
    <form onSubmit={guardar} className="space-y-6">
      {/* Logotipo */}
      <div>
        <p className="label-section mb-2 block">Logotipo</p>
        <div className="flex items-center gap-4">
          {form.logo_url ? (
            <div className="relative">
              <img
                src={form.logo_url}
                alt="Logotipo da instituição"
                className="h-16 w-16 rounded-md border border-line object-contain bg-surface"
              />
              <button
                type="button"
                onClick={removerLogo}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-xs text-surface"
                title="Remover logotipo"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-line text-ink-faint">
              Sem logo
            </div>
          )}
          <div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void escolherLogo(e)} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-secondary"
            >
              {uploading && <Spinner className="h-4 w-4" />}
              {uploading ? 'A carregar...' : form.logo_url ? 'Substituir' : 'Carregar logotipo'}
            </button>
            <p className="mt-1 text-xs text-ink-faint">PNG, JPG, WebP ou SVG até 2MB. Mostrado no site e nos recibos.</p>
          </div>
        </div>
      </div>

      {/* Nome */}
      <div>
        <label htmlFor="inst-nome" className="label-section mb-1 block">
          Nome da instituição *
        </label>
        <input
          id="inst-nome"
          value={form.nome}
          onChange={set('nome')}
          className="input w-full"
          placeholder="Ex.: Centro de Formação Profissional Horizonte"
          maxLength={120}
          required
        />
      </div>

      {/* Contactos */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="inst-tel" className="label-section mb-1 block">
            Telefone
          </label>
          <input
            id="inst-tel"
            value={form.telefone}
            onChange={set('telefone')}
            className="input w-full"
            placeholder="+258 21 000 000"
          />
        </div>
        <div>
          <label htmlFor="inst-email" className="label-section mb-1 block">
            Email
          </label>
          <input
            id="inst-email"
            type="email"
            value={form.email}
            onChange={set('email')}
            className="input w-full"
            placeholder="geral@instituicao.co.mz"
          />
        </div>
      </div>

      <div>
        <label htmlFor="inst-end" className="label-section mb-1 block">
          Endereço
        </label>
        <textarea
          id="inst-end"
          value={form.endereco}
          onChange={set('endereco')}
          rows={2}
          className="input w-full"
          placeholder="Av. Principal, nº 123, Maputo"
        />
      </div>

      {/* Segurança: código de finanças */}
      <div className="rounded-md border border-line bg-canvas p-4">
        <p className="label-section mb-1">Segurança — área de finanças</p>
        <p className="mb-3 text-xs text-ink-faint">
          Código exigido para abrir a página de Pagamentos. É guardado com hash no servidor — nunca é visível nem
          enviado ao navegador. Para alterar, escreva um novo código (mín. 4 caracteres) e guarde; para manter o
          actual, deixe vazio.
        </p>
        <label htmlFor="inst-codfin" className="label-section mb-1 block">
          Novo código de acesso às finanças
        </label>
        <input
          id="inst-codfin"
          type="password"
          value={form.novo_codigo_financas}
          onChange={set('novo_codigo_financas')}
          className="input w-full max-w-xs font-mono"
          placeholder="Deixe vazio para manter o actual"
          autoComplete="new-password"
        />
      </div>

      {/* Valores pós-conclusão */}
      <div className="rounded-md border border-line bg-canvas p-4">
        <p className="label-section mb-1">Pós-conclusão — valores</p>
        <p className="mb-3 text-xs text-ink-faint">
          Valores cobrados ao aluno quando conclui um curso (alocados automaticamente na página Pós-Conclusão).
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="inst-vcert" className="label-section mb-1 block">
              Valor do certificado (MZN)
            </label>
            <input
              id="inst-vcert"
              type="number"
              min="0"
              step="1"
              value={form.valor_certificado}
              onChange={set('valor_certificado')}
              className="input w-full tnum"
            />
          </div>
          <div>
            <label htmlFor="inst-vfaixa" className="label-section mb-1 block">
              Valor da faixa de graduação (MZN)
            </label>
            <input
              id="inst-vfaixa"
              type="number"
              min="0"
              step="1"
              value={form.valor_faixa}
              onChange={set('valor_faixa')}
              className="input w-full tnum"
            />
          </div>
        </div>
      </div>

      {erro && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={loading || uploading || !mudou} className="btn-primary">
          {loading ? 'A guardar...' : 'Guardar'}
        </button>
        <button type="button" onClick={() => setForm(original)} disabled={!mudou || loading} className="btn-secondary">
          Reverter
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Preçário por curso (027): mensalidade + dia limite que geram as cobranças
// ---------------------------------------------------------------------------

interface PrecosDoAno {
  cursos: Curso[]
  precos: ConfigPagamento[]
}

function SecaoPrecario() {
  const anoActual = new Date().getFullYear()
  const [ano, setAno] = useState(anoActual)
  const fetcher = useCallback(async () => {
    const [cursosRes, precosRes] = await Promise.all([
      supabase.from('cursos').select('*').eq('ativo', true).order('nome'),
      supabase.from('config_pagamentos').select('*').eq('ano_lectivo', ano),
    ])
    if (cursosRes.error || precosRes.error) {
      return { data: null, error: cursosRes.error ?? precosRes.error }
    }
    return {
      data: { cursos: (cursosRes.data ?? []) as Curso[], precos: (precosRes.data ?? []) as ConfigPagamento[] },
      error: null,
    }
  }, [ano])
  const { data, loading, error, reload } = useAsyncData<PrecosDoAno>(fetcher, [ano])

  const [form, setForm] = useState<Record<string, { mensalidade: string; dia: string }>>({})
  const [aGravar, setAGravar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Sincroniza os inputs quando o ano ou os dados mudam.
  useEffect(() => {
    const novo: Record<string, { mensalidade: string; dia: string }> = {}
    for (const curso of data?.cursos ?? []) {
      const preco = data?.precos.find((p) => p.curso_id === curso.id)
      novo[curso.id] = {
        mensalidade: preco ? String(preco.valor_mensalidade) : '',
        dia: preco ? String(preco.dia_limite) : '5',
      }
    }
    setForm(novo)
  }, [data])

  const alterar = (cursoId: string, campo: 'mensalidade' | 'dia', valor: string) =>
    setForm((f) => ({ ...f, [cursoId]: { ...(f[cursoId] ?? { mensalidade: '', dia: '5' }), [campo]: valor } }))

  const guardar = async () => {
    setErro(null)
    const linhas = Object.entries(form)
      .filter(([, v]) => v.mensalidade.trim() !== '')
      .map(([cursoId, v]) => {
        const mensalidade = Number(v.mensalidade)
        const dia = Number(v.dia || '5')
        return { curso_id: cursoId, ano_lectivo: ano, valor_mensalidade: mensalidade, dia_limite: dia }
      })

    if (linhas.length === 0) {
      setErro('Preencha a mensalidade de pelo menos um curso.')
      return
    }
    for (const l of linhas) {
      if (!Number.isFinite(l.valor_mensalidade) || l.valor_mensalidade < 0) {
        setErro('As mensalidades têm de ser números iguais ou superiores a zero.')
        return
      }
      if (!Number.isInteger(l.dia_limite) || l.dia_limite < 1 || l.dia_limite > 28) {
        setErro('O dia limite tem de ser um número inteiro entre 1 e 28.')
        return
      }
    }

    // Mensalidade apagada = curso sem preçário neste ano: remover a linha
    // antiga, senão o valor anterior continuaria a gerar cobranças.
    const vazios = Object.entries(form)
      .filter(([, v]) => v.mensalidade.trim() === '')
      .map(([cursoId]) => cursoId)

    setAGravar(true)
    const { error: err } = await supabase
      .from('config_pagamentos')
      .upsert(linhas, { onConflict: 'curso_id,ano_lectivo' })
    if (err) {
      setAGravar(false)
      setErro(err.message)
      return
    }
    if (vazios.length > 0) {
      const { error: errDel } = await supabase
        .from('config_pagamentos')
        .delete()
        .eq('ano_lectivo', ano)
        .in('curso_id', vazios)
      if (errDel) {
        setAGravar(false)
        setErro(errDel.message)
        return
      }
    }
    setAGravar(false)
    showSuccess(`Preçário de ${ano} guardado.`)
    void reload()
  }

  return (
    <div className="cell mt-6 max-w-3xl p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="label-section">Preçário por curso — mensalidades</p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-muted" htmlFor="precario-ano">
            Ano lectivo
          </label>
          <input
            id="precario-ano"
            type="number"
            min="2000"
            max="2100"
            value={ano}
            onChange={(e) => setAno(Number(e.target.value) || anoActual)}
            className="input w-24 py-1 text-sm tnum"
          />
        </div>
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        O valor mensal e o dia limite são usados por <strong>Gerar cobranças do mês</strong> em Pagamentos. Sem preçário
        para o curso/ano, nenhuma mensalidade é gerada para os alunos desse curso.
      </p>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorMessage message={error} onRetry={() => void reload()} />
      ) : (data?.cursos ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-4 text-sm text-ink-muted">
          Não há cursos activos. Crie um curso primeiro.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-2 py-2.5 font-medium">Curso</th>
                  <th className="px-2 py-2.5 font-medium">Mensalidade (MZN)</th>
                  <th className="px-2 py-2.5 font-medium">Dia limite</th>
                  <th className="px-2 py-2.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(data?.cursos ?? []).map((curso) => {
                  const v = form[curso.id] ?? { mensalidade: '', dia: '5' }
                  const configurado = v.mensalidade.trim() !== ''
                  return (
                    <tr key={curso.id} className="hover:bg-canvas">
                      <td className="px-2 py-2">
                        <p className="font-medium text-ink">{curso.nome}</p>
                        <p className="font-mono text-[11px] text-ink-faint">{curso.codigo}</p>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={v.mensalidade}
                          onChange={(e) => alterar(curso.id, 'mensalidade', e.target.value)}
                          className="input w-32 py-1 tnum"
                          placeholder="Ex.: 1200"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min="1"
                          max="28"
                          step="1"
                          value={v.dia}
                          onChange={(e) => alterar(curso.id, 'dia', e.target.value)}
                          className="input w-20 py-1 tnum"
                          disabled={!configurado}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={configurado ? 'aprovado' : 'pendente'}>
                          {configurado ? 'Configurado' : 'Sem preçário'}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

          <div className="mt-4 flex items-center gap-2">
            <button onClick={() => void guardar()} disabled={aGravar} className="btn-primary">
              {aGravar && <Spinner className="h-4 w-4" />}
              {aGravar ? 'A guardar...' : `Guardar preçário de ${ano}`}
            </button>
            <span className="text-xs text-ink-faint">
              Deixar a mensalidade vazia mantém o curso sem preçário neste ano.
            </span>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cobranças (026): catálogo que o admin configura + aplicação a alunos
// ---------------------------------------------------------------------------

function CobrancaModal({
  cobranca,
  cursos,
  onClose,
  onDone,
}: {
  cobranca: Cobranca | null
  cursos: Curso[]
  onClose: () => void
  onDone: () => void
}) {
  useEscapeKey(onClose)
  const [nome, setNome] = useState(cobranca?.nome ?? '')
  const [descricao, setDescricao] = useState(cobranca?.descricao ?? '')
  const [cursoId, setCursoId] = useState(cobranca?.curso_id ?? '')
  const [categoria, setCategoria] = useState<CategoriaReceita>(cobranca?.categoria ?? 'outro')
  const [valor, setValor] = useState(String(cobranca?.valor ?? ''))
  const [ativo, setAtivo] = useState(cobranca?.ativo ?? true)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = Number(valor)
    if (!nome.trim()) {
      setErro('Indique o nome da cobrança (ex.: Testes, Material, Exame).')
      return
    }
    if (!Number.isFinite(v) || v < 0) {
      setErro('O valor tem de ser um número igual ou superior a zero.')
      return
    }
    setErro(null)
    setLoading(true)
    const payload = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      valor: v,
      categoria,
      curso_id: cursoId || null,
      ativo,
    }
    const { error } = cobranca
      ? await supabase.from('cobrancas').update(payload).eq('id', cobranca.id)
      : await supabase.from('cobrancas').insert(payload)
    setLoading(false)
    if (error) {
      setErro(error.message)
      return
    }
    showSuccess(cobranca ? 'Cobrança actualizada.' : 'Cobrança criada.')
    onDone()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm" role="dialog" aria-modal>
      <form onSubmit={guardar} className="overlay-in w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h3 className="font-serif text-lg font-semibold text-ink">{cobranca ? 'Editar cobrança' : 'Nova cobrança'}</h3>
        <p className="mt-1 text-[13px] text-ink-muted">O que os alunos devem pagar (ex.: Testes, material, exame).</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="label-section mb-1 block">Nome *</label>
            <input
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="input w-full"
              placeholder="Ex.: Testes (3 testes)"
            />
          </div>
          <div>
            <label className="label-section mb-1 block">Descrição</label>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              className="input w-full"
              placeholder="Ex.: Contribuição para material e aula — 3 testes no período."
            />
          </div>
          <div>
            <label className="label-section mb-1 block">Curso</label>
            <select value={cursoId} onChange={(e) => setCursoId(e.target.value)} className="input w-full">
              <option value="">Todos os cursos</option>
              {cursos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({c.codigo})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-faint">
              Com curso definido, "Aplicar a alunos" só alcança alunos desse curso.
            </p>
          </div>
          <div>
            <label className="label-section mb-1 block">Categoria financeira</label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as CategoriaReceita)}
              className="input w-full"
            >
              {(Object.keys(CATEGORIA_RECEITA_LABELS) as CategoriaReceita[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORIA_RECEITA_LABELS[c]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-faint">
              Agrupa esta cobrança na estatística diária de Finanças.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-section mb-1 block">Valor (MZN) *</label>
              <input
                required
                type="number"
                min="0"
                step="1"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="input w-full tnum"
                placeholder="Ex.: 500"
              />
            </div>
            <div>
              <label className="label-section mb-1 block">Estado</label>
              <select
                value={ativo ? '1' : '0'}
                onChange={(e) => setAtivo(e.target.value === '1')}
                className="input w-full"
              >
                <option value="1">Activa</option>
                <option value="0">Desactivada</option>
              </select>
            </div>
          </div>
        </div>

        {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading && <Spinner className="h-4 w-4" />}
            Guardar
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

interface AlunoCobranca {
  id: string
  numero_estudante: string
  inscricoes: { nome_completo: string } | null
  turmas: { nome_turma: string } | null
}

function AplicarCobrancaModal({ cobranca, onClose }: { cobranca: Cobranca; onClose: () => void }) {
  useEscapeKey(onClose)
  const [modo, setModo] = useState<'todos' | 'escolher'>('todos')
  const [escolhidos, setEscolhidos] = useState<string[]>([])
  const [pesquisa, setPesquisa] = useState('')
  const [alunos, setAlunos] = useState<AlunoCobranca[] | null>(null)
  const [erroAlunos, setErroAlunos] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      // Cobrança de um curso: só os alunos desse curso aparecem para escolher.
      let query = supabase
        .from('alunos_matriculados')
        .select('id, numero_estudante, inscricoes(nome_completo), turmas!inner(nome_turma)')
        .eq('estado_aluno', 'ativo')
      if (cobranca.curso_id) query = query.eq('turmas.curso_id', cobranca.curso_id)
      const { data, error } = await query.order('numero_estudante')
      if (!vivo) return
      if (error) setErroAlunos(error.message)
      else setAlunos((data ?? []) as unknown as AlunoCobranca[])
    })()
    return () => {
      vivo = false
    }
  }, [cobranca.curso_id])

  const q = pesquisa.trim().toLowerCase()
  const filtrados = (alunos ?? []).filter(
    (a) =>
      !q ||
      (a.inscricoes?.nome_completo ?? '').toLowerCase().includes(q) ||
      a.numero_estudante.toLowerCase().includes(q),
  )

  const alternar = (id: string) =>
    setEscolhidos((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))

  const aplicar = async () => {
    setErro(null)
    if (modo === 'escolher' && escolhidos.length === 0) {
      setErro('Escolha pelo menos um aluno — ou use a opção de aplicar a todos os activos.')
      return
    }
    setLoading(true)
    const { data, error } = await supabase.rpc('aplicar_cobranca', {
      p_cobranca_id: cobranca.id,
      p_aluno_ids: modo === 'escolher' ? escolhidos : null,
      p_todos_activos: modo === 'todos',
    })
    setLoading(false)
    const r = (data as { aplicados: number; mensagem: string }[] | null)?.[0]
    if (error) {
      setErro(error.message)
      return
    }
    showSuccess(r?.mensagem ?? 'Cobrança aplicada.')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm" role="dialog" aria-modal>
      <div className="overlay-in flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface p-6">
        <h3 className="font-serif text-lg font-semibold text-ink">Aplicar cobrança</h3>
        <p className="mt-1 text-[13px] text-ink-muted">
          <strong>{cobranca.nome}</strong> — {Number(cobranca.valor).toLocaleString('pt-PT')} MT
          {cobranca.curso_id && (
            <span className="block text-xs text-ink-faint">Só alunos do curso {cobranca.cursos?.nome ?? ''}</span>
          )}
        </p>

        <div className="mt-4 space-y-3">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" checked={modo === 'todos'} onChange={() => setModo('todos')} />
              Todos os alunos activos
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" checked={modo === 'escolher'} onChange={() => setModo('escolher')} />
              Escolher alunos
            </label>
          </div>

          {modo === 'escolher' && (
            <div>
              <input
                value={pesquisa}
                onChange={(e) => setPesquisa(e.target.value)}
                className="input w-full"
                placeholder="Pesquisar por nome ou nº..."
              />
              <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-line">
                {erroAlunos ? (
                  <p className="p-3 text-sm text-danger">{erroAlunos}</p>
                ) : !alunos ? (
                  <p className="p-3 text-sm text-ink-muted">A carregar alunos...</p>
                ) : filtrados.length === 0 ? (
                  <p className="p-3 text-sm text-ink-muted">Nenhum aluno activo corresponde à pesquisa.</p>
                ) : (
                  filtrados.map((a) => (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-2 text-[13px] last:border-b-0 hover:bg-canvas"
                    >
                      <input type="checkbox" checked={escolhidos.includes(a.id)} onChange={() => alternar(a.id)} />
                      <span className="font-medium text-ink">{a.inscricoes?.nome_completo ?? '—'}</span>
                      <span className="tnum text-ink-faint">{a.numero_estudante}</span>
                      <span className="ml-auto text-ink-faint">{a.turmas?.nome_turma ?? ''}</span>
                    </label>
                  ))
                )}
              </div>
                  <p className="mt-1 text-xs text-ink-faint">Seleccionados: {escolhidos.length}</p>
            </div>
          )}

          <p className="text-xs text-ink-faint">
            Alunos que já têm esta cobrança são ignorados — aplicar de novo não duplica dívidas.
          </p>
        </div>

        {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => void aplicar()} disabled={loading} className="btn-primary flex-1">
            {loading && <Spinner className="h-4 w-4" />}
            Aplicar
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

function SecaoCobrancas() {
  const fetcher = useCallback(
    async () =>
      (await supabase.from('cobrancas').select('*, cursos(nome, codigo)').order('nome')) as {
        data: Cobranca[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: cobrancas, loading, error, reload } = useAsyncData<Cobranca[]>(fetcher, [])

  const cursosFetcher = useCallback(
    async () =>
      (await supabase.from('cursos').select('*').eq('ativo', true).order('nome')) as {
        data: Curso[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: cursos } = useAsyncData<Curso[]>(cursosFetcher, [])

  const [modal, setModal] = useState<{ modo: 'nova' } | { modo: 'editar'; cobranca: Cobranca } | null>(null)
  const [aplicando, setAplicando] = useState<Cobranca | null>(null)

  const alternarAtivo = async (c: Cobranca) => {
    const { error: err } = await supabase.from('cobrancas').update({ ativo: !c.ativo }).eq('id', c.id)
    if (err) showError(err.message)
    else {
      showSuccess(c.ativo ? 'Cobrança desactivada.' : 'Cobrança activada.')
      void reload()
    }
  }

  const eliminar = async (c: Cobranca) => {
    // Histórico financeiro: bloqueia em vez de apagar dívidas registadas.
    const { count } = await supabase
      .from('cobrancas_alunos')
      .select('id', { count: 'exact', head: true })
      .eq('cobranca_id', c.id)
    if (count && count > 0) {
      showError(
        `Não é possível eliminar "${c.nome}": ${count} aluno(s) já têm esta cobrança registada. Desactive-a em vez de apagar.`,
      )
      return
    }
    const ok = await confirmarAcao({
      title: 'Eliminar cobrança',
      message: `Eliminar "${c.nome}" do catálogo?\n\nNenhum aluno tem esta cobrança atribuída.`,
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    const { error: err } = await supabase.from('cobrancas').delete().eq('id', c.id)
    if (err) showError(err.message)
    else {
      showSuccess('Cobrança eliminada.')
      void reload()
    }
  }

  return (
    <div className="cell mt-6 max-w-3xl p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="label-section">Cobranças — o que os alunos devem pagar</p>
        <button onClick={() => setModal({ modo: 'nova' })} className="btn-primary px-3 py-1.5 text-xs">
          + Nova cobrança
        </button>
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        Crie tipos de cobrança (testes, material, exame...) e atribua-os aos alunos. As cobranças atribuídas ficam
        pendentes na página <strong>Pagamentos</strong>, onde se marcam como pagas e se emite o recibo.
      </p>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorMessage message={error} onRetry={() => void reload()} />
      ) : (cobrancas ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-4 text-sm text-ink-muted">
          Ainda não há cobranças configuradas. Crie a primeira — ex.: <em>Testes (3 testes)</em>,{' '}
          <em>Material e aula</em>, <em>Exame</em>.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                <th className="px-2 py-2.5 font-medium">Cobrança</th>
                <th className="px-2 py-2.5 font-medium text-right">Valor</th>
                <th className="px-2 py-2.5 font-medium">Estado</th>
                <th className="px-2 py-2.5 font-medium text-right">Acções</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(cobrancas ?? []).map((c) => (
                <tr key={c.id} className="hover:bg-canvas">
                  <td className="px-2 py-2.5">
                    <p className="font-medium text-ink">{c.nome}</p>
                    {c.descricao && <p className="text-xs text-ink-faint">{c.descricao}</p>}
                    <p className="text-[11px] text-ink-muted">{CATEGORIA_RECEITA_LABELS[c.categoria]}</p>
                    {c.cursos?.nome && (
                      <p className="text-[11px] font-medium text-accent-ink">Só curso: {c.cursos.nome}</p>
                    )}
                  </td>
                  <td className="px-2 py-2.5 tnum text-right text-ink">
                    {Number(c.valor).toLocaleString('pt-PT')} MT
                  </td>
                  <td className="px-2 py-2.5">
                    <Badge variant={c.ativo ? 'aprovado' : 'neutro'}>{c.ativo ? 'Activa' : 'Desactivada'}</Badge>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setAplicando(c)}
                        disabled={!c.ativo}
                        className="btn-primary px-2.5 py-1 text-xs"
                        title={c.ativo ? 'Aplicar a alunos' : 'Active a cobrança primeiro'}
                      >
                        Aplicar a alunos
                      </button>
                      <button
                        onClick={() => setModal({ modo: 'editar', cobranca: c })}
                        className="btn-secondary px-2.5 py-1 text-xs"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => void alternarAtivo(c)}
                        className="btn-secondary px-2.5 py-1 text-xs"
                      >
                        {c.ativo ? 'Desactivar' : 'Activar'}
                      </button>
                      <button onClick={() => void eliminar(c)} className="btn-danger px-2.5 py-1 text-xs">
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <CobrancaModal
          cobranca={modal.modo === 'editar' ? modal.cobranca : null}
          cursos={cursos ?? []}
          onClose={() => setModal(null)}
          onDone={() => void reload()}
        />
      )}
      {aplicando && <AplicarCobrancaModal cobranca={aplicando} onClose={() => setAplicando(null)} />}
    </div>
  )
}

export default function Configuracoes() {
  const fetcher = useCallback(async () => {
    return (await supabase.from('config_instituicao').select('*').eq('id', 1).maybeSingle()) as {
      data: ConfigInstituicao | null
      error: { message: string } | null
    }
  }, [])

  const { data, loading, error, reload } = useAsyncData<ConfigInstituicao | null>(fetcher, [])

  return (
    <AdminGate>
      <PageHeader
        title="Configurações"
        subtitle="Dados da instituição — edição restrita ao administrador"
      />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorMessage message={error} onRetry={() => void reload()} />
      ) : (
        <div className="cell max-w-3xl p-5">
          <p className="label-section mb-4">Identificação e contactos</p>
          <ConfigForm
            inicial={
              data ?? {
                id: 1,
                nome: NOME_INSTITUICAO_DEFAULT,
                telefone: null,
                email: null,
                endereco: null,
                logo_url: null,
                codigo_financas: null,
                valor_certificado: 350,
                valor_faixa: 500,
                updated_at: '',
                updated_by: null,
              }
            }
          />
          {data?.updated_at && (
            <p className="mt-6 border-t border-line pt-3 text-xs text-ink-faint">
              Última actualização: {new Date(data.updated_at).toLocaleString('pt-PT')}
            </p>
          )}
        </div>
      )}

      <SecaoPrecario />
      <SecaoCobrancas />
    </AdminGate>
  )
}
