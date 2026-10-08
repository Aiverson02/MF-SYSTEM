import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Curso, TipoDocumento } from '../types/database'
import { TIPO_DOC_LABELS } from '../types/database'
import { Spinner } from './ui'
import { pushToast } from './ToastHost'

const TODOS_TIPOS: TipoDocumento[] = ['bi', 'foto_passe', 'certificado', 'comprovativo_pagamento']

interface Ficheiro {
  file: File
  tipo: TipoDocumento
}

export default function InscricaoForm({ cursos, onSucesso }: { cursos: Curso[]; onSucesso?: (numero: string) => void }) {
  const [form, setForm] = useState({
    nome_completo: '',
    numero_bi: '',
    data_nascimento: '',
    genero: '',
    telefone_whatsapp: '',
    curso_id: '',
    turno_pretendido: '',
  })
  const [ficheiros, setFicheiros] = useState<Ficheiro[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [numeroGerado, setNumeroGerado] = useState<string | null>(null)

  const cursoSeleccionado = useMemo(() => cursos.find((c) => c.id === form.curso_id) ?? null, [cursos, form.curso_id])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const adicionarFicheiros = (lista: FileList | null) => {
    if (!lista) return
    const novos: Ficheiro[] = []
    for (const file of Array.from(lista)) {
      const okTipo = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)
      if (!okTipo) {
        pushToast(`${file.name}: formato não suportado (use PNG, JPEG, WebP ou PDF).`, 'erro')
        continue
      }
      if (file.size > 10 * 1024 * 1024) {
        pushToast(`${file.name}: excede o limite de 10MB.`, 'erro')
        continue
      }
      // tenta inferir o tipo pelo nome; por omissão BI
      let tipo: TipoDocumento = 'bi'
      const n = file.name.toLowerCase()
      if (n.includes('passe') || n.includes('foto')) tipo = 'foto_passe'
      else if (n.includes('cert')) tipo = 'certificado'
      else if (n.includes('comprov') || n.includes('pag')) tipo = 'comprovativo_pagamento'
      novos.push({ file, tipo })
    }
    setFicheiros((prev) => [...prev, ...novos])
  }

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)

    if (!form.nome_completo.trim() || !form.numero_bi.trim() || !form.data_nascimento || !form.telefone_whatsapp.trim()) {
      setErro('Preencha os campos obrigatórios: nome, BI, data de nascimento e WhatsApp.')
      return
    }
    if (!form.curso_id || !form.turno_pretendido) {
      setErro('Seleccione o curso e o turno pretendido.')
      return
    }
    // BI obrigatório em ficheiro (mesma regra do trigger 003: sem docs não bloqueia, mas pedimos BI)
    if (!ficheiros.some((f) => f.tipo === 'bi')) {
      setErro('Anexe uma imagem ou PDF do Bilhete de Identidade.')
      return
    }

    setLoading(true)
    try {
      // 1. Criar inscrição via RPC pública (gera o número no servidor, origem 'online')
      const { data: criada, error: errIns } = await supabase.rpc('submeter_inscricao_publica', {
        p_nome_completo: form.nome_completo.trim(),
        p_numero_bi: form.numero_bi.trim().toUpperCase(),
        p_data_nascimento: form.data_nascimento,
        p_genero: form.genero || null,
        p_email: null,
        p_telefone_whatsapp: form.telefone_whatsapp.trim(),
        p_curso_id: form.curso_id,
        p_turno_pretendido: form.turno_pretendido,
      })

      const r = (criada as { numero_inscricao: string; inscricao_id: string }[] | null)?.[0]
      if (errIns || !r?.inscricao_id) {
        throw errIns ?? new Error('Não foi possível submeter. Verifique se já não existe uma inscrição com este BI.')
      }

      // 2. Upload dos documentos ao bucket privado e registo na tabela
      for (const f of ficheiros) {
        const ext = f.file.name.split('.').pop() ?? 'bin'
        const path = `${r.inscricao_id}/${f.tipo}-${Date.now()}.${ext}`
        const { error: errUp } = await supabase.storage.from('documentos-inscricao').upload(path, f.file, {
          contentType: f.file.type,
          upsert: false,
        })
        if (errUp) throw errUp

        const { error: errDoc } = await supabase.from('documentos_inscricao').insert({
          inscricao_id: r.inscricao_id,
          tipo_documento: f.tipo,
          url_ficheiro: path,
        })
        if (errDoc) throw errDoc
      }

      setNumeroGerado(r.numero_inscricao)
      onSucesso?.(r.numero_inscricao)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao submeter a inscrição.')
    } finally {
      setLoading(false)
    }
  }

  // Confirmação com o número gerado
  if (numeroGerado) {
    return (
      <div className="cell p-8 text-center">
        <p className="font-serif text-2xl font-semibold text-ok">Inscrição submetida!</p>
        <p className="mt-2 text-sm text-ink-muted">
          Guarde o seu número de inscrição para consultar o estado:
        </p>
        <p className="mt-3 font-mono text-xl font-medium text-ink">{numeroGerado}</p>
        <button
          onClick={() => {
            setNumeroGerado(null)
            setForm({
              nome_completo: '',
              numero_bi: '',
              data_nascimento: '',
              genero: '',
              telefone_whatsapp: '',
              curso_id: '',
              turno_pretendido: '',
            })
            setFicheiros([])
          }}
          className="btn-secondary mt-6"
        >
          Nova inscrição
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submeter} className="cell p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label-section mb-1 block">Nome completo *</label>
          <input value={form.nome_completo} onChange={set('nome_completo')} className="input w-full" required />
        </div>
        <div>
          <label className="label-section mb-1 block">Nº do Bilhete de Identidade *</label>
          <input value={form.numero_bi} onChange={set('numero_bi')} className="input w-full font-mono" required />
        </div>
        <div>
          <label className="label-section mb-1 block">Data de nascimento *</label>
          <input type="date" value={form.data_nascimento} onChange={set('data_nascimento')} className="input w-full" required />
        </div>
        <div>
          <label className="label-section mb-1 block">Género</label>
          <select value={form.genero} onChange={set('genero')} className="input w-full">
            <option value="">Prefiro não indicar</option>
            <option value="F">Feminino</option>
            <option value="M">Masculino</option>
          </select>
        </div>
        <div>
          <label className="label-section mb-1 block">Telefone WhatsApp *</label>
          <input value={form.telefone_whatsapp} onChange={set('telefone_whatsapp')} className="input w-full" placeholder="+258 84 000 0000" required />
        </div>
        <div>
          <label className="label-section mb-1 block">Curso *</label>
          <select value={form.curso_id} onChange={set('curso_id')} className="input w-full" required>
            <option value="">Seleccionar curso...</option>
            {cursos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} ({c.codigo})
              </option>
            ))}
          </select>
          {cursoSeleccionado?.duracao && (
            <p className="mt-1 text-xs text-ink-faint">Duração: {cursoSeleccionado.duracao}</p>
          )}
        </div>
        <div>
          <label className="label-section mb-1 block">Turno pretendido *</label>
          <select value={form.turno_pretendido} onChange={set('turno_pretendido')} className="input w-full" required>
            <option value="">Seleccionar turno...</option>
            <option value="manha">Manhã</option>
            <option value="tarde">Tarde</option>
            <option value="pos_laboral">Pós-Laboral</option>
          </select>
        </div>
      </div>

      {/* Documentos */}
      <div className="mt-5 border-t border-line pt-4">
        <label className="label-section mb-1 block">Documentos *</label>
        <p className="mb-2 text-xs text-ink-faint">
          BI obrigatório. Opcional: foto de passe, certificado, comprovativo de pagamento (PNG, JPEG, WebP ou PDF, máx. 10MB cada).
        </p>
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={(e) => adicionarFicheiros(e.target.files)}
          className="input w-full file:mr-3 file:rounded file:border-0 file:bg-raised file:px-2 file:py-1 file:text-xs file:text-ink"
        />
        {ficheiros.length > 0 && (
          <div className="mt-2 divide-y divide-line rounded-md border border-line">
            {ficheiros.map((f, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 truncate text-[13px] text-ink">{f.file.name}</span>
                <select
                  value={f.tipo}
                  onChange={(e) =>
                    setFicheiros((prev) => prev.map((x, j) => (j === i ? { ...x, tipo: e.target.value as TipoDocumento } : x)))
                  }
                  className="input py-0.5 text-xs"
                >
                  {TODOS_TIPOS.map((t) => (
                    <option key={t} value={t}>
                      {TIPO_DOC_LABELS[t]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setFicheiros((prev) => prev.filter((_, j) => j !== i))}
                  className="btn-ghost px-1.5 py-0.5 text-xs text-danger"
                  aria-label="Remover ficheiro"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {erro && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

      <button type="submit" disabled={loading} className="btn-primary mt-5 w-full py-2.5">
        {loading && <Spinner className="h-4 w-4" />}
        {loading ? 'A submeter...' : 'Submeter inscrição'}
      </button>
    </form>
  )
}
