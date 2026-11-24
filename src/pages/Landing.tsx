import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import '../styles/landing.css'
import {
  carregarCatalogo,
  duracaoBase,
  mensalidadeDe,
  precoBase,
  type Catalogo,
} from '../lib/catalogo'
import type { Turno } from '../types/database'
import Cabecalho from '../components/landing/Cabecalho'
import Talao from '../components/landing/Talao'
import TabelaCursos from '../components/landing/TabelaCursos'
import Valores from '../components/landing/Valores'
import ComoFunciona from '../components/landing/ComoFunciona'
import Localizacao from '../components/landing/Localizacao'
import FormularioInscricao from '../components/landing/FormularioInscricao'

const TITULO = 'Moz Future — Cursos de 3 meses'
const DESCRICAO =
  'Associação de Formação Profissional Moz Future. 14 cursos de 3 meses, 200 MT por mês. Inscreva-se online.'

/**
 * Página pública da instituição.
 *
 * Vive fora do painel (rota `/`) e não usa os tokens do SIGA: tem o seu próprio
 * CSS (`styles/landing.css`), para que a marca do prospecto não mude com o tema
 * escuro da secretaria. Os dados vêm de `catalogo_publico()` e a inscrição da
 * RPC pública — o visitante não tem sessão.
 */
export default function Landing() {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null)
  const [falhou, setFalhou] = useState(false)
  const [cursoId, setCursoId] = useState<string | null>(null)
  const [turno, setTurno] = useState<Turno | null>(null)

  const carregar = useCallback(async () => {
    setFalhou(false)
    try {
      setCatalogo(await carregarCatalogo())
    } catch {
      setFalhou(true)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Título e descrição próprios: a LP não é o painel.
  useEffect(() => {
    const tituloAnterior = document.title
    const descricao = document.querySelector('meta[name="description"]')
    const descricaoAnterior = descricao?.getAttribute('content') ?? null

    document.title = TITULO
    if (descricao) descricao.setAttribute('content', DESCRICAO)

    return () => {
      document.title = tituloAnterior
      if (descricao && descricaoAnterior !== null) descricao.setAttribute('content', descricaoAnterior)
    }
  }, [])

  const irParaFormulario = useCallback(() => {
    document.getElementById('inscricao')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const escolherCurso = useCallback(
    (id: string) => {
      setCursoId(id)
      irParaFormulario()
    },
    [irParaFormulario],
  )

  const cursos = catalogo?.cursos ?? []
  const cursoEscolhido = cursos.find((c) => c.id === cursoId) ?? null
  // Preço e duração saem do catálogo da instituição: nunca um número fixo no
  // código que o painel possa cobrar diferente.
  const precoTabela = precoBase(cursos)
  const duracaoPadrao = duracaoBase(cursos)
  const mensalidade = cursoEscolhido ? mensalidadeDe(cursoEscolhido) : precoTabela
  const edicao = catalogo?.edicao ?? new Date().getFullYear()
  const locais = catalogo?.locais ?? []

  return (
    <div className="lp" id="topo">
      <Cabecalho
        instituicao={catalogo?.instituicao ?? { nome: '', telefone: null, email: null, endereco: null, logo_url: null }}
        edicao={edicao}
        onInscrever={irParaFormulario}
      />

      <main>
        <section className="lp-envolver lp-hero">
          <div>
            <h1 className="lp-h1">
              <span className="lp-h1-linha">Três meses.</span>
              <span className="lp-h1-linha lp-h1-destaque">Uma profissão.</span>
            </h1>
            <p className="lp-sub">
              A Moz Future forma pessoas para trabalhar — do atendimento à electricidade, da cozinha ao
              design gráfico. Escolha o curso, inscreva-se online e a secretaria confirma a inscrição.
            </p>
            <ul className="lp-factos">
              <li className="lp-facto">
                <b>{duracaoPadrao}</b>
                <span>duração base</span>
              </li>
              <li className="lp-facto">
                <b>{precoTabela.toLocaleString('pt-PT')} MT</b>
                <span>por mês</span>
              </li>
              <li className="lp-facto">
                <b>{cursos.length || 14}</b>
                <span>cursos</span>
              </li>
              <li className="lp-facto">
                <b>3</b>
                <span>turnos</span>
              </li>
            </ul>
          </div>

          <Talao
            curso={cursoEscolhido}
            turno={turno}
            mensalidade={mensalidade}
            edicao={edicao}
            totalCursos={cursos.length || 14}
            duracaoBase={duracaoPadrao}
            onInscrever={irParaFormulario}
          />
        </section>

        <section className="lp-sec">
          <div className="lp-envolver">
            <div className="lp-sec-cabeca">
              <div>
                <p className="lp-etiqueta">O que leva</p>
                <h2 className="lp-h2">Curto, prático e no fim há certificado.</h2>
              </div>
            </div>
            <div className="lp-passos" style={{ marginTop: '28px' }}>
              <div className="lp-passo">
                <h3 className="lp-passo-titulo">Um certificado no fim</h3>
                <p className="lp-passo-texto">
                  Terminados os três meses e as avaliações, a instituição emite o certificado do curso.
                </p>
              </div>
              <div className="lp-passo">
                <h3 className="lp-passo-titulo">{precoTabela.toLocaleString('pt-PT')} MT por mês</h3>
                <p className="lp-passo-texto">Pago mês a mês, durante o curso.</p>
              </div>
              <div className="lp-passo">
                <h3 className="lp-passo-titulo">Turnos que cabem no dia</h3>
                <p className="lp-passo-texto">Manhã, tarde ou pós-laboral, conforme as turmas abertas.</p>
              </div>
              <div className="lp-passo">
                <h3 className="lp-passo-titulo">Até 3 cursos</h3>
                <p className="lp-passo-texto">
                  Pode inscrever-se em três cursos ao mesmo tempo, no mesmo formulário.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-sec" id="cursos">
          <div className="lp-envolver">
            <div className="lp-sec-cabeca">
              <div>
                <p className="lp-etiqueta">01 — Cursos</p>
                <h2 className="lp-h2">As {cursos.length || 14} formações.</h2>
              </div>
              <p className="lp-sec-nota">
                Cada linha mostra a duração e a mensalidade. Escolha uma para começar a inscrição.
              </p>
            </div>

            {catalogo === null && !falhou && (
              <p className="lp-carregando">A carregar o catálogo…</p>
            )}

            {falhou && (
              <p className="lp-erro" style={{ marginTop: '24px' }}>
                <span aria-hidden>!</span>
                <span>
                  Não foi possível carregar os cursos agora. Verifique a ligação e{' '}
                  <button
                    type="button"
                    className="lp-ligacao"
                    style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}
                    onClick={() => void carregar()}
                  >
                    tente outra vez
                  </button>
                  .
                </span>
              </p>
            )}

            {cursos.length > 0 && (
              <TabelaCursos cursos={cursos} cursoEscolhido={cursoId} onEscolher={escolherCurso} />
            )}
          </div>
        </section>

        <section className="lp-sec">
          <div className="lp-envolver">
            <Valores mensalidade={mensalidade} />
          </div>
        </section>

        <section className="lp-sec">
          <div className="lp-envolver">
            <div className="lp-sec-cabeca">
              <div>
                <p className="lp-etiqueta">02 — Como funciona</p>
                <h2 className="lp-h2">Da inscrição à primeira aula.</h2>
              </div>
            </div>
            <ComoFunciona />
          </div>
        </section>

        {locais.length > 0 && (
          <section className="lp-sec" id="onde-estamos">
            <div className="lp-envolver">
              <div className="lp-sec-cabeca">
                <div>
                  <p className="lp-etiqueta">03 — Onde estamos</p>
                  <h2 className="lp-h2">Duas localizações.</h2>
                </div>
                <p className="lp-sec-nota">
                  Aulas e atendimento nestes dois pontos. Confirme na secretaria o local do seu curso.
                </p>
              </div>
              <Localizacao locais={locais} />
            </div>
          </section>
        )}

        <section className="lp-sec" id="inscricao">
          <div className="lp-envolver">
            <div className="lp-sec-cabeca">
              <div>
                <p className="lp-etiqueta">04 — Inscrição</p>
                <h2 className="lp-h2">Inscreva-se agora.</h2>
              </div>
              <p className="lp-sec-nota">
                Preencha os dados, anexe o BI e envie. Recebe um número de inscrição no fim.
              </p>
            </div>

            <div className="lp-inscricao">
              <div>
                <h3 className="lp-h3">O que precisa ter à mão</h3>
                <p className="lp-texto" style={{ marginTop: '10px', fontSize: '0.92rem' }}>
                  Uma foto do BI (ou o ficheiro em PDF) e, se já pagou, o comprovativo. O número do BI é
                  opcional — a foto é obrigatória.
                </p>
                <p className="lp-texto" style={{ marginTop: '14px', fontSize: '0.92rem' }}>
                  Sem a foto do BI não é possível submeter — se tiver dificuldade em digitalizar o documento,
                  a secretaria ajuda no balcão.
                </p>
                <p className="lp-pagamentos">
                  Mensalidade de {mensalidade.toLocaleString('pt-PT')} MT · curso completo{' '}
                  {(mensalidade * 3).toLocaleString('pt-PT')} MT
                </p>
              </div>

              <FormularioInscricao
                cursos={cursos}
                cursoInicial={cursoId}
                mensalidadeBase={precoTabela}
                onTurnoChange={setTurno}
              />
            </div>
          </div>
        </section>

        <section className="lp-sec">
          <div className="lp-envolver">
            <div className="lp-sec-cabeca">
              <div>
                <p className="lp-etiqueta">05 — Perguntas frequentes</p>
                <h2 className="lp-h2">Antes de se inscrever.</h2>
              </div>
            </div>

            <div className="lp-faq">
              <details className="lp-pergunta">
                <summary>Preciso de levar o BI?</summary>
                <p>
                  Sim. No formulário pedimos uma foto ou ficheiro do BI (JPG, PNG, WebP ou PDF, até 5 MB). O
                  número do BI é opcional, a imagem é obrigatória.
                </p>
              </details>
              <details className="lp-pergunta">
                <summary>Posso inscrever-me em mais de um curso?</summary>
                <p>
                  Sim, até 3 cursos em simultâneo. Cada curso é uma inscrição separada, com o seu próprio
                  número; a secretaria valida os documentos de cada uma.
                </p>
              </details>
              <details className="lp-pergunta">
                <summary>Quando começam as aulas?</summary>
                <p>
                  A secretaria confirma a data de início e o turno depois de validar a inscrição. A edição
                  corrente é {edicao}.
                </p>
              </details>
              <details className="lp-pergunta">
                <summary>Como pago?</summary>
                <p>
                  {mensalidade.toLocaleString('pt-PT')} MT por mês, pago mês a mês durante o curso. Pode pagar
                  por M-Pesa, e-Mola ou transferência, e anexar o comprovativo na inscrição — ou pagar na
                  secretaria e entregar o recibo lá.
                </p>
              </details>
              <details className="lp-pergunta">
                <summary>A inscrição no site já garante a vaga?</summary>
                <p>
                  A inscrição fica registada como pendente. A vaga é confirmada pela secretaria depois de
                  validar o BI e o pagamento.
                </p>
              </details>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-rodape">
        <div className="lp-envolver lp-rodape-in">
          <p style={{ margin: 0 }}>
            Associação de Formação Profissional Moz Future · Edição {edicao}
          </p>
          <p style={{ margin: 0 }}>
            <Link to="/login">Área reservada</Link>
          </p>
        </div>
      </footer>
    </div>
  )
}
