import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ConfigInstituicao } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { NOME_INSTITUICAO_DEFAULT } from '../hooks/useInstituicao'
import { ErrorMessage, LoadingBlock, PageHeader, Spinner } from '../components/ui'
import { showSuccess } from '../lib/alerts'
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
    </AdminGate>
  )
}
