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

interface Escolha {
  cursoId: string
  turno: Turno | ''
}

interface LinhaSucesso {
  numero: string
  curso: string
  turno: Turno
  mensalidade: number
}

interface Sucesso {
  linhas: LinhaSucesso[]
  avisos: string[]
  falhas: { curso: string; erro: string }[]
}

const vazia = (): Escolha => ({ cursoId: '', turno: '' })

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

/**
 * Formulário público: até três cursos, uma inscrição por curso.
 *
 * Cada curso escolhido cria a sua própria inscrição (número próprio, BI e
 * validação na secretaria). Se uma falhar, as outras ficam registadas — o
 * candidato vê exactamente o que entrou e o que ficou por fazer.
 */
export default function FormularioInscricao({ cursos, cursoInicial, mensalidadeBase, onTurnoChange }: Props) {
  const base = useId()
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [numeroBi, setNumeroBi] = useState('')
  const [escolhas, setEscolhas] = useState<Escolha[]>(() => [
    { cursoId: cursoInicial ?? '', turno: '' },
    vazia(),
    vazia(),
  ])
  const [bi, setBi] = useState<File | null>(null)
  const [recibo, setRecibo] = useState<File | null>(null)
  const [reciboTexto, setReciboTexto] = useState('')
  const [invalidos, setInvalidos] = useState<Record<string, boolean>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [sucesso, setSucesso] = useState<Sucesso | null>(null)

  const cursoDe = (id: string) => cursos.find((c) => c.id === id) ?? null
  const preenchidas = escolhas.filter((e) => e.cursoId)
  const mensalidade = preenchidas.reduce((soma, e) => soma + (cursoDe(e.cursoId)?.mensalidade ?? mensalidadeBase), 0)

  // O curso escolhido na tabela passa a ser o primeiro do formulário.
  useEffect(() => {
    if (!cursoInicial) return
    setEscolhas((actuais) => {
      if (actuais.some((e) => e.cursoId === cursoInicial)) return actuais
      const proximas = [...actuais]
      proximas[0] = { ...proximas[0], cursoId: cursoInicial }
      return proximas
    })
  }, [cursoInicial])

  // O talão lateral mostra o turno do primeiro curso válido.
  const primeiroTurno = (lista: Escolha[]): Turno | null => {
    for (const e of lista) if (e.cursoId && e.turno) return e.turno
    return null
  }

  useEffect(() => {
    onTurnoChange?.(primeiroTurno(escolhas))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escolhas])

  const alterarEscolha = (indice: number, mudanca: Partial<Escolha>) => {
    setEscolhas((actuais) => {
      const proximas = actuais.map((e, i) => {
        if (i !== indice) return e
        const nova = { ...e, ...mudanca }
        // Mudar de curso pode remover o turno escolhido (turmas diferentes).
        if (mudanca.cursoId !== undefined) {
          const turnos = turnosDoCurso(cursoDe(mudanca.cursoId))
          if (nova.turno && !turnos.some((t) => t.turno === nova.turno)) nova.turno = ''
        }
        return nova
      })
      return proximas
    })
  }

  const limpar = () => {
    setNome('')
    setTelefone('')
    setEmail('')
    setNumeroBi('')
    setEscolhas([vazia(), vazia(), vazia()])
    onTurnoChange?.(null)
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

    // Primeiro curso é obrigatório; os restantes são opcionais mas, se
    // escolhidos, precisam de turno.
    const validas: { curso: CursoPublico; turno: Turno }[] = []
    escolhas.forEach((escolha, i) => {
      const curso = cursoDe(escolha.cursoId)
      if (i === 0 && !curso) faltas.curso0 = true
      if (curso && !escolha.turno) faltas[`turno${i}`] = true
      if (curso && escolha.turno) validas.push({ curso, turno: escolha.turno })
    })

    const ids = validas.map((v) => v.curso.id)
    const duplicado = ids.find((id, i) => ids.indexOf(id) !== i)
    if (duplicado) {
      setErro('Escolheu o mesmo curso duas vezes. Cada curso só pode entrar uma vez.')
      return
    }

    if (!bi) faltas.bi = true
    setInvalidos(faltas)

    const nomes: string[] = []
    if (faltas.nome) nomes.push('o nome completo')
    if (faltas.telefone) nomes.push('o WhatsApp')
    if (faltas.curso0) nomes.push('o primeiro curso')
    if (Object.keys(faltas).some((k) => k.startsWith('turno'))) nomes.push('o turno de cada curso')
    if (faltas.bi) nomes.push('a foto do BI')

    if (nomes.length > 0) {
      setErro(`Falta preencher ${nomes.join(', ')}.`)
      return
    }

    setEnviando(true)
    const linhas: LinhaSucesso[] = []
    const avisos: string[] = []
    const falhas: { curso: string; erro: string }[] = []

    try {
      for (let i = 0; i < validas.length; i++) {
        const { curso, turno } = validas[i]
        try {
          const resultado = await submeterInscricao(
            {
              nomeCompleto: nome,
              telefone,
              email,
              numeroBi,
              cursoId: curso.id,
              turno,
            },
            {
              bi,
              // O comprovativo é um só: fica na primeira inscrição.
              reciboFicheiro: i === 0 ? recibo : null,
              reciboTexto: i === 0 ? reciboTexto : '',
            },
          )
          linhas.push({
            numero: resultado.numero,
            curso: curso.nome,
            turno,
            mensalidade: curso.mensalidade ?? mensalidadeBase,
          })
          for (const a of resultado.avisos) {
            if (!avisos.includes(a)) avisos.push(a)
          }
        } catch (err) {
          falhas.push({
            curso: curso.nome,
            erro:
              err instanceof ErroInscricao
                ? err.message
                : 'Não foi possível enviar esta inscrição.',
          })
        }
      }

      if (linhas.length === 0) {
        setErro(falhas[0]?.erro ?? 'Não foi possível enviar a inscrição agora. Tente outra vez.')
        return
      }

      setSucesso({ linhas, avisos, falhas })
    } finally {
      setEnviando(false)
    }
  }

  if (sucesso) {
    return (
      <div className="lp-recibo" role="status" aria-live="polite">
        <span className="lp-recibo-selo">
          {sucesso.linhas.length === 1 ? 'Inscrição registada' : `${sucesso.linhas.length} inscrições registadas`}
        </span>
        {sucesso.linhas.map((linha) => (
          <div key={linha.numero} className="lp-recibo-bloco">
            <p className="lp-recibo-numero">{linha.numero}</p>
            <ul className="lp-recibo-linhas">
              <li>
                <span>Curso</span>
                <b>{linha.curso}</b>
              </li>
              <li>
                <span>Turno</span>
                <b>{TURNO_NOMES[linha.turno]}</b>
              </li>
              <li>
                <span>Mensalidade</span>
                <b>{linha.mensalidade.toLocaleString('pt-PT')} MT</b>
              </li>
            </ul>
          </div>
        ))}
        <p className="lp-texto">
          Guarde {sucesso.linhas.length === 1 ? 'este número' : 'estes números'}. A secretaria confirma a vaga e diz
          quando começam as aulas.
        </p>
        <p className="lp-texto">
          <b>Estado:</b> pendente — aguarda confirmação dos documentos.
        </p>

        {sucesso.avisos.length > 0 && (
          <p className="lp-aviso">
            A inscrição ficou registada, mas há documentos em falta: {sucesso.avisos.join(' ')}
          </p>
        )}

        {sucesso.falhas.length > 0 && (
          <p className="lp-erro">
            <span aria-hidden>!</span>
            <span>
              Não entrou: {sucesso.falhas.map((f) => `${f.curso} (${f.erro})`).join('; ')}. Pode tentar de novo ou
              fazer esta inscrição na secretaria.
            </span>
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

          <div className="lp-campo lp-campo--largo">
            <p className="lp-campo-legenda">
              Cursos <span className="lp-obrigatorio">*</span>
            </p>
            <p className="lp-ajuda" style={{ marginTop: 0, marginBottom: '10px' }}>
              Pode escolher até três cursos. Cada um fica com a sua própria inscrição.
            </p>

            <div className="lp-escolhas">
              {escolhas.map((escolha, i) => {
                const curso = cursoDe(escolha.cursoId)
                const turnos = turnosDoCurso(curso)
                const n = i + 1
                return (
                  <div className="lp-escolha" key={i}>
                    <div className="lp-campo">
                      <label htmlFor={`${base}-curso-${i}`}>
                        {n}º curso {i === 0 ? <span className="lp-obrigatorio">*</span> : <span className="lp-ajuda">(opcional)</span>}
                      </label>
                      <select
                        id={`${base}-curso-${i}`}
                        className="lp-input"
                        value={escolha.cursoId}
                        onChange={(e) => alterarEscolha(i, { cursoId: e.target.value })}
                        aria-invalid={invalidos[`curso${i}`] || undefined}
                      >
                        <option value="">{i === 0 ? 'Escolher curso...' : 'Não quero outro curso'}</option>
                        {cursos.map((c) => (
                          <option
                            key={c.id}
                            value={c.id}
                            disabled={escolhas.some((outra, j) => j !== i && outra.cursoId === c.id)}
                          >
                            {c.nome}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="lp-campo">
                      <label htmlFor={`${base}-turno-${i}`}>
                        Turno {escolha.cursoId ? <span className="lp-obrigatorio">*</span> : null}
                      </label>
                      <select
                        id={`${base}-turno-${i}`}
                        className="lp-input"
                        value={escolha.turno}
                        onChange={(e) => alterarEscolha(i, { turno: e.target.value as Turno | '' })}
                        disabled={!escolha.cursoId}
                        aria-invalid={invalidos[`turno${i}`] || undefined}
                      >
                        <option value="">{escolha.cursoId ? 'Escolher turno...' : 'Escolha primeiro o curso'}</option>
                        {turnos.map((t) => (
                          <option key={t.turno} value={t.turno}>
                            {TURNO_NOMES[t.turno]}
                            {t.vagas > 0 ? ` — ${t.vagas} vaga(s)` : ' — sem vagas'}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <CampoFicheiro
            id={`${base}-bi`}
            legenda="Foto ou ficheiro do BI"
            ajuda="JPG, PNG, WebP ou PDF, até 5 MB. Uma foto da frente do BI chega. É usada nas inscrições que enviar."
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
            ajuda="Opcional. Anexe o recibo (M-Pesa, e-Mola, transferência) ou escreva o que pagou. Fica na primeira inscrição."
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
          {enviando
            ? 'A enviar...'
            : `Enviar ${preenchidas.length > 1 ? `${preenchidas.length} inscrições` : 'inscrição'}`}
        </button>

        <p className="lp-form-rodape">
          Ao enviar, os seus dados ficam registados no sistema da instituição e são vistos apenas pela secretaria. A
          inscrição só fica confirmada depois da validação dos documentos.
        </p>
      </div>
    </form>
  )
}
