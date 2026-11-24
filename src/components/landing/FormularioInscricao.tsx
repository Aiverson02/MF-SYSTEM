import { useEffect, useId, useState } from 'react'
import { TURNO_NOMES, turnosDoCurso, type CursoPublico } from '../../lib/catalogo'
import {
  ErroInscricao,
  submeterInscricao,
  TEXTO_RECIBO_MAX,
  validarAnexo,
} from '../../lib/inscricaoOnline'
import type { Turno } from '../../types/database'

interface Props {
  cursos: CursoPublico[]
  cursoInicial: string | null
  /** Preço de tabela, antes de haver curso escolhido. */
  mensalidadeBase: number
  onTurnoChange?: (turno: Turno | null) => void
}

interface Sucesso {
  numero: string
  curso: string
  turno: Turno
  mensalidade: number
  avisos: string[]
}

/** Campo de ficheiro com pré-visualização (imagens) e remoção. */
function CampoFicheiro({
  id,
  legenda,
  ajuda,
  obrigatorio,
  aceites,
  file,
  invalido,
  onEscolher,
  onRemover,
}: {
  id: string
  legenda: string
  ajuda: string
  obrigatorio?: boolean
  aceites: string
  file: File | null
  invalido?: boolean
  onEscolher: (file: File | null) => void
  onRemover: () => void
}) {
  const [previa, setPrevia] = useState<string | null>(null)

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPrevia(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPrevia(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <div className="lp-campo lp-campo--largo">
      <label htmlFor={id} className="lp-campo-legenda">
        {legenda} {obrigatorio && <span className="lp-obrigatorio">*</span>}
      </label>
      <div className="lp-anexo">
        <input
          id={id}
          type="file"
          accept={aceites}
          aria-invalid={invalido || undefined}
          onChange={(e) => onEscolher(e.target.files?.[0] ?? null)}
        />
        {file && (
          <button type="button" className="lp-anexo-remover" onClick={onRemover}>
            Remover
          </button>
        )}
      </div>
      {file ? (
        <p className="lp-previa">
          {previa && <img src={previa} alt="Pré-visualização do documento escolhido" />}
          <span>
            {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
          </span>
        </p>
      ) : (
        <p className="lp-ajuda">{ajuda}</p>
      )}
    </div>
  )
}

/** Formulário público: cria a inscrição (pendente) e anexa BI e recibo. */
export default function FormularioInscricao({ cursos, cursoInicial, mensalidadeBase, onTurnoChange }: Props) {
  const base = useId()
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [numeroBi, setNumeroBi] = useState('')
  const [cursoId, setCursoId] = useState(cursoInicial ?? '')
  const [turno, setTurno] = useState<Turno | ''>('')
  const [bi, setBi] = useState<File | null>(null)
  const [recibo, setRecibo] = useState<File | null>(null)
  const [reciboTexto, setReciboTexto] = useState('')
  const [invalidos, setInvalidos] = useState<Record<string, boolean>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [sucesso, setSucesso] = useState<Sucesso | null>(null)

  const curso = cursos.find((c) => c.id === cursoId) ?? null
  const turnos = turnosDoCurso(curso)
  const mensalidade = curso?.mensalidade ?? mensalidadeBase

  // O curso escolhido na tabela passa a ser o do formulário.
  useEffect(() => {
    if (cursoInicial) setCursoId(cursoInicial)
  }, [cursoInicial])

  // Mudar de curso pode remover o turno escolhido (turmas diferentes).
  useEffect(() => {
    if (turno && !turnos.some((t) => t.turno === turno)) {
      setTurno('')
      onTurnoChange?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursoId])

  const escolherTurno = (novo: Turno | '') => {
    setTurno(novo)
    onTurnoChange?.(novo === '' ? null : novo)
  }

  const limpar = () => {
    setNome('')
    setTelefone('')
    setEmail('')
    setNumeroBi('')
    setCursoId('')
    escolherTurno('')
    setBi(null)
    setRecibo(null)
    setReciboTexto('')
    setInvalidos({})
    setErro(null)
    setSucesso(null)
  }

  const escolherAnexo = (file: File | null, tipo: 'bi' | 'recibo') => {
    if (!file) {
      if (tipo === 'bi') setBi(null)
      else setRecibo(null)
      return
    }
    const problema = validarAnexo(file)
    if (problema) {
      setErro(problema)
      return
    }
    setErro(null)
    if (tipo === 'bi') setBi(file)
    else setRecibo(file)
  }

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (enviando) return
    setErro(null)

    const faltas: Record<string, boolean> = {}
    if (!nome.trim()) faltas.nome = true
    if (!telefone.trim()) faltas.telefone = true
    if (!cursoId) faltas.curso = true
    if (!turno) faltas.turno = true
    if (!bi) faltas.bi = true
    setInvalidos(faltas)

    const nomes: string[] = []
    if (faltas.nome) nomes.push('o nome completo')
    if (faltas.telefone) nomes.push('o WhatsApp')
    if (faltas.curso) nomes.push('o curso')
    if (faltas.turno) nomes.push('o turno')
    if (faltas.bi) nomes.push('a foto do BI')

    if (nomes.length > 0) {
      setErro(`Falta preencher ${nomes.join(', ')}.`)
      document.getElementById(`${base}-${Object.keys(faltas)[0]}`)?.focus()
      return
    }

    setEnviando(true)
    try {
      const resultado = await submeterInscricao(
        {
          nomeCompleto: nome,
          telefone,
          email,
          numeroBi,
          cursoId,
          turno: turno as Turno,
        },
        { bi, reciboFicheiro: recibo, reciboTexto },
      )
      setSucesso({
        numero: resultado.numero,
        curso: curso?.nome ?? '',
        turno: turno as Turno,
        mensalidade,
        avisos: resultado.avisos,
      })
    } catch (err) {
      setErro(
        err instanceof ErroInscricao
          ? err.message
          : 'Não foi possível enviar a inscrição agora. Tente outra vez.',
      )
    } finally {
      setEnviando(false)
    }
  }

  if (sucesso) {
    return (
      <div className="lp-recibo" role="status" aria-live="polite">
        <span className="lp-recibo-selo">Inscrição registada</span>
        <p className="lp-recibo-numero">{sucesso.numero}</p>
        <p className="lp-texto">
          Guarde este número. A secretaria confirma a vaga e diz quando começam as aulas.
        </p>
        <ul className="lp-recibo-linhas">
          <li>
            <span>Curso</span>
            <b>{sucesso.curso}</b>
          </li>
          <li>
            <span>Turno</span>
            <b>{TURNO_NOMES[sucesso.turno]}</b>
          </li>
          <li>
            <span>Mensalidade</span>
            <b>{sucesso.mensalidade.toLocaleString('pt-PT')} MT</b>
          </li>
          <li>
            <span>Estado</span>
            <b>Pendente — aguarda confirmação</b>
          </li>
        </ul>
        {sucesso.avisos.length > 0 && (
          <p className="lp-aviso">
            A inscrição ficou registada, mas há documentos em falta: {sucesso.avisos.join(' ')}
          </p>
        )}
        <button type="button" className="lp-btn lp-btn--fantasma lp-btn--larga" onClick={limpar}>
          Fazer outra inscrição
        </button>
      </div>
    )
  }

  return (
    <form className="lp-form" onSubmit={enviar} noValidate>
      <div className="lp-form-topo">
        <span>Inscrição online</span>
        <span>{mensalidade.toLocaleString('pt-PT')} MT/mês</span>
      </div>

      <div className="lp-form-corpo">
        <div className="lp-grelha">
          <div className="lp-campo lp-campo--largo">
            <label htmlFor={`${base}-nome`}>
              Nome completo <span className="lp-obrigatorio">*</span>
            </label>
            <input
              id={`${base}-nome`}
              className="lp-input"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="name"
              aria-invalid={invalidos.nome || undefined}
            />
          </div>

          <div className="lp-campo">
            <label htmlFor={`${base}-telefone`}>
              WhatsApp <span className="lp-obrigatorio">*</span>
            </label>
            <input
              id={`${base}-telefone`}
              className="lp-input"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+258 84 000 0000"
              aria-invalid={invalidos.telefone || undefined}
            />
          </div>

          <div className="lp-campo">
            <label htmlFor={`${base}-email`}>Email</label>
            <input
              id={`${base}-email`}
              className="lp-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="opcional"
            />
          </div>

          <div className="lp-campo">
            <label htmlFor={`${base}-bi-numero`}>Nº do BI</label>
            <input
              id={`${base}-bi-numero`}
              className="lp-input lp-mono"
              value={numeroBi}
              onChange={(e) => setNumeroBi(e.target.value.toUpperCase())}
              placeholder="opcional"
            />
            <p className="lp-ajuda">Se tiver o BI à mão. A foto do BI é que é obrigatória.</p>
          </div>

          <div className="lp-campo">
            <label htmlFor={`${base}-curso`}>
              Curso <span className="lp-obrigatorio">*</span>
            </label>
            <select
              id={`${base}-curso`}
              className="lp-input"
              value={cursoId}
              onChange={(e) => setCursoId(e.target.value)}
              aria-invalid={invalidos.curso || undefined}
            >
              <option value="">Escolher curso...</option>
              {cursos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="lp-campo">
            <label htmlFor={`${base}-turno`}>
              Turno <span className="lp-obrigatorio">*</span>
            </label>
            <select
              id={`${base}-turno`}
              className="lp-input"
              value={turno}
              onChange={(e) => escolherTurno(e.target.value as Turno | '')}
              aria-invalid={invalidos.turno || undefined}
            >
              <option value="">Escolher turno...</option>
              {turnos.map((t) => (
                <option key={t.turno} value={t.turno}>
                  {TURNO_NOMES[t.turno]}
                  {t.vagas > 0 ? ` — ${t.vagas} vaga(s)` : ''}
                </option>
              ))}
            </select>
          </div>

          <CampoFicheiro
            id={`${base}-bi`}
            legenda="Foto ou ficheiro do BI"
            ajuda="JPG, PNG, WebP ou PDF, até 5 MB. Uma foto da frente do BI chega."
            obrigatorio
            aceites="image/jpeg,image/png,image/webp,application/pdf"
            file={bi}
            invalido={invalidos.bi}
            onEscolher={(file) => escolherAnexo(file, 'bi')}
            onRemover={() => setBi(null)}
          />

          <CampoFicheiro
            id={`${base}-recibo`}
            legenda="Comprovativo de pagamento"
            ajuda="Opcional. Anexe o recibo (M-Pesa, e-Mola, transferência) ou escreva o que pagou."
            aceites="image/jpeg,image/png,image/webp,application/pdf"
            file={recibo}
            onEscolher={(file) => escolherAnexo(file, 'recibo')}
            onRemover={() => setRecibo(null)}
          />

          {!recibo && (
            <div className="lp-campo lp-campo--largo">
              <label htmlFor={`${base}-recibo-texto`}>Ou escreva o pagamento</label>
              <textarea
                id={`${base}-recibo-texto`}
                className="lp-input"
                value={reciboTexto}
                onChange={(e) => setReciboTexto(e.target.value.slice(0, TEXTO_RECIBO_MAX))}
                maxLength={TEXTO_RECIBO_MAX}
                placeholder="Ex.: paguei 200 MT por M-Pesa, referência 1234. / Pago na secretaria."
              />
              <p className="lp-ajuda">Deixe em branco se ainda vai pagar na secretaria.</p>
            </div>
          )}
        </div>

        <div aria-live="polite">
          {erro && (
            <p className="lp-erro">
              <span aria-hidden>!</span>
              <span>{erro}</span>
            </p>
          )}
        </div>

        <button type="submit" className="lp-btn lp-btn--larga" style={{ marginTop: '18px' }} disabled={enviando}>
          {enviando ? 'A enviar...' : 'Enviar inscrição'}
        </button>

        <p className="lp-form-rodape">
          Ao enviar, os seus dados ficam registados no sistema da instituição e são vistos apenas pela
          secretaria. A inscrição só fica confirmada depois da validação dos documentos.
        </p>
      </div>
    </form>
  )
}
