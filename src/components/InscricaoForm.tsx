import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Curso } from '../types/database'
import { Spinner } from './ui'

/** Resultado da submissão curso a curso (o laço de 3 cursos corre no cliente). */
interface ResultadoCurso {
  curso: string
  ok: boolean
  numero?: string
  erro?: string
}

interface Props {
  cursos: Curso[]
  /**
   * Chamado quando pelo menos uma inscrição foi criada. `falhas` contém os
   * cursos recusados (ex.: limite de 3 atingido a meio da submissão) — o
   * chamador recarrega a lista sempre e só fecha o modal se `falhas` = 0.
   */
  onSucesso?: (numeros: string[], falhas: ResultadoCurso[]) => void
}

export default function InscricaoForm({ cursos, onSucesso }: Props) {
  const [form, setForm] = useState({
    nome_completo: '',
    numero_bi: '',
    genero: '',
    telefone_whatsapp: '',
    curso1: '',
    curso2: '',
    curso3: '',
    turno_pretendido: '',
  })
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultados, setResultados] = useState<ResultadoCurso[] | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const cursosSeleccionados = [form.curso1, form.curso2, form.curso3].filter(Boolean)

  const nomeDe = (id: string) => cursos.find((c) => c.id === id)?.nome ?? id

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)

    if (!form.nome_completo.trim() || !form.telefone_whatsapp.trim()) {
      setErro('Preencha os campos obrigatórios: nome completo e telefone WhatsApp.')
      return
    }
    if (!form.turno_pretendido) {
      setErro('Seleccione o turno pretendido.')
      return
    }
    if (cursosSeleccionados.length === 0) {
      setErro('Seleccione pelo menos um curso.')
      return
    }
    if (new Set(cursosSeleccionados).size !== cursosSeleccionados.length) {
      setErro('Os cursos escolhidos têm de ser distintos — remova as repetições.')
      return
    }

    setLoading(true)
    const feitos: ResultadoCurso[] = []
    try {
      // Uma inscrição por curso, todas com os mesmos dados pessoais. A RPC
      // valida no servidor o limite de 3 cursos activos (identidade: BI ou
      // nome+celular) e o duplicado do mesmo curso, por isso uma falha no
      // percurso não invalida as já criadas — mostramos o resultado curso a
      // curso em vez de abortar em silêncio.
      for (const cursoId of cursosSeleccionados) {
        const { data, error } = await supabase.rpc('submeter_inscricao_publica', {
          p_nome_completo: form.nome_completo.trim(),
          p_numero_bi: form.numero_bi.trim() ? form.numero_bi.trim().toUpperCase() : null,
          p_data_nascimento: null,
          p_genero: form.genero || null,
          p_email: null,
          p_telefone_whatsapp: form.telefone_whatsapp.trim(),
          p_curso_id: cursoId,
          p_turno_pretendido: form.turno_pretendido,
        })
        const r = (data as { numero_inscricao: string; inscricao_id: string }[] | null)?.[0]
        if (error || !r?.inscricao_id) {
          // errIns do supabase-js não é instanceof Error: usa .message para a
          // mensagem do servidor chegar ao utilizador (ex.: "Limite de
          // inscrições atingido…", "Já existe uma inscrição activa…").
          feitos.push({
            curso: nomeDe(cursoId),
            ok: false,
            erro: error?.message || 'Não foi possível submeter. Verifique os dados e o curso seleccionado.',
          })
        } else {
          feitos.push({ curso: nomeDe(cursoId), ok: true, numero: r.numero_inscricao })
        }
      }

      const numeros = feitos.filter((f) => f.ok).map((f) => f.numero!)
      const falhas = feitos.filter((f) => !f.ok)

      if (numeros.length === 0) {
        setErro(falhas[0]?.erro ?? 'Erro ao submeter a inscrição.')
        return
      }
      setResultados(feitos)
      onSucesso?.(numeros, falhas)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao submeter a inscrição.')
    } finally {
      setLoading(false)
    }
  }

  const reiniciar = () => {
    setResultados(null)
    setErro(null)
    setForm({
      nome_completo: '',
      numero_bi: '',
      genero: '',
      telefone_whatsapp: '',
      curso1: '',
      curso2: '',
      curso3: '',
      turno_pretendido: '',
    })
  }

  // Confirmação com os números gerados
  if (resultados) {
    const falhas = resultados.filter((r) => !r.ok)
    return (
      <div className="cell p-8 text-center">
        <p className="font-serif text-2xl font-semibold text-ok">
          {falhas.length === 0
            ? resultados.length > 1
              ? 'Inscrições submetidas!'
              : 'Inscrição submetida!'
            : 'Submissão parcial'}
        </p>
        <p className="mt-2 text-sm text-ink-muted">Guarde os números de inscrição para consultar o estado:</p>
        <ul className="mt-3 space-y-1">
          {resultados.map((r) => (
            <li key={r.curso} className="text-sm">
              {r.ok ? (
                <span className="text-ink">
                  <span className="font-mono text-base font-medium">{r.numero}</span>
                  <span className="text-ink-muted"> — {r.curso}</span>
                </span>
              ) : (
                <span className="text-danger">
                  ✗ {r.curso}: {r.erro}
                </span>
              )}
            </li>
          ))}
        </ul>
        <button onClick={reiniciar} className="btn-secondary mt-6">
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
          <label className="label-section mb-1 block">Telefone WhatsApp *</label>
          <input
            value={form.telefone_whatsapp}
            onChange={set('telefone_whatsapp')}
            className="input w-full"
            placeholder="+258 84 000 0000"
            required
          />
        </div>
        <div>
          <label className="label-section mb-1 block">Nº do Bilhete de Identidade (opcional)</label>
          <input
            value={form.numero_bi}
            onChange={set('numero_bi')}
            className="input w-full font-mono"
            placeholder="Deixe vazio se não tiver"
          />
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
          <label className="label-section mb-1 block">Turno pretendido *</label>
          <select value={form.turno_pretendido} onChange={set('turno_pretendido')} className="input w-full" required>
            <option value="">Seleccionar turno...</option>
            <option value="manha">Manhã</option>
            <option value="tarde">Tarde</option>
            <option value="pos_laboral">Pós-Laboral</option>
          </select>
        </div>
      </div>

      <p className="label-section mt-5 mb-1">Cursos — escolha até 3 *</p>
      <div className="space-y-3">
        {([
          ['curso1', 'Curso 1 *'],
          ['curso2', 'Curso 2 (opcional)'],
          ['curso3', 'Curso 3 (opcional)'],
        ] as const).map(([campo, rotulo]) => {
          const valor = form[campo]
          const escolhido = cursos.find((c) => c.id === valor)
          return (
            <div key={campo}>
              <label className="label-section mb-1 block">{rotulo}</label>
              <select value={valor} onChange={set(campo)} className="input w-full" required={campo === 'curso1'}>
                <option value="">{campo === 'curso1' ? 'Seleccionar curso...' : '— Nenhum —'}</option>
                {cursos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.codigo})
                  </option>
                ))}
              </select>
              {escolhido?.duracao && <p className="mt-1 text-xs text-ink-faint">Duração: {escolhido.duracao}</p>}
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-xs text-ink-faint">
        Pode inscrever-se em até 3 cursos na mesma submissão. Cada aluno tem no máximo 3 cursos activos em
        simultâneo; a 4ª inscrição activa é recusada.
      </p>

      {erro && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

      <button type="submit" disabled={loading} className="btn-primary mt-5 w-full py-2.5">
        {loading && <Spinner className="h-4 w-4" />}
        {loading
          ? 'A submeter...'
          : cursosSeleccionados.length > 1
            ? `Submeter ${cursosSeleccionados.length} inscrições`
            : 'Submeter inscrição'}
      </button>
    </form>
  )
}
