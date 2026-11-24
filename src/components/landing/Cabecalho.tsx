import type { InstituicaoPublica } from '../../lib/catalogo'

interface Props {
  instituicao: InstituicaoPublica
  /** Ano da edição que aceita inscrições (ex.: 2027). */
  edicaoAno: number
  onInscrever: () => void
}

/** Cabeçalho: marca (logotipo quando carregado) + carimbo da edição + CTA. */
export default function Cabecalho({ instituicao, edicaoAno, onInscrever }: Props) {
  return (
    <header className="lp-topo">
      <div className="lp-envolver lp-topo-in">
        <a className="lp-marca" href="#topo" aria-label={instituicao.nome}>
          {instituicao.logo_url ? (
            <img className="lp-marca-logo" src={instituicao.logo_url} alt="" />
          ) : null}
          <span>
            <span className="lp-marca-nome">Moz Future</span>
            <span className="lp-marca-sub">Associação de Formação Profissional</span>
          </span>
        </a>

        <div className="lp-topo-accao">
          <p className="lp-selo">
            <span className="lp-selo-ponto" aria-hidden />
            Inscrições abertas · Edição {edicaoAno}
          </p>
          <button type="button" className="lp-btn" onClick={onInscrever}>
            Inscrever-me
          </button>
        </div>
      </div>
    </header>
  )
}
