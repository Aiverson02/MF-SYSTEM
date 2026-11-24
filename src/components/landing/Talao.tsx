import { TURNO_NOMES, type CursoPublico } from '../../lib/catalogo'
import type { Turno } from '../../types/database'

interface Props {
  curso: CursoPublico | null
  turno: Turno | null
  /** Mensalidade do curso escolhido ou o preço de tabela do catálogo. */
  mensalidade: number
  edicao: number
  /** Ano da edição (ex.: 2027). */
  edicaoAno: number | null
  /** Nº de cursos abertos — o catálogo real tem mais do que as 14 formações. */
  totalCursos: number
  /** Duração de tabela, mostrada enquanto nenhum curso está escolhido. */
  duracaoBase: string
  onInscrever: () => void
}

const moeda = (valor: number) => `${valor.toLocaleString('pt-PT')} MT`

/**
 * Talão de inscrição — o objecto que a família guarda. Acompanha o scroll e
 * resume a escolha: curso, turno, duração, mensalidade e total do curso.
 */
export default function Talao({
  curso,
  turno,
  mensalidade,
  edicao,
  edicaoAno,
  totalCursos,
  duracaoBase,
  onInscrever,
}: Props) {
  return (
    <aside className="lp-talao" aria-label="Resumo da inscrição">
      <div className="lp-talao-topo">
        <span className="lp-talao-titulo">Talão de inscrição</span>
        <span className="lp-talao-edicao">
          Edição {edicao}
          {edicaoAno ? ` · ${edicaoAno}` : ''}
        </span>
      </div>

      <p className="lp-talao-curso">{curso ? curso.nome : 'Escolha o seu curso'}</p>
      <p className="lp-talao-nota">
        {curso
          ? `${turno ? TURNO_NOMES[turno] : 'Turno a escolher'} · ${curso.duracao}`
          : `Escolha uma das ${totalCursos} formações abertas.`}
      </p>

      <ul className="lp-talao-linhas">
        <li className="lp-talao-linha">
          <span>Mensalidade</span>
          <b>{moeda(mensalidade)} / mês</b>
        </li>
        <li className="lp-talao-linha">
          <span>Duração</span>
          <b>{curso?.duracao ?? duracaoBase}</b>
        </li>
        <li className="lp-talao-linha lp-talao-linha--total">
          <span>Três mensalidades</span>
          <b>{moeda(mensalidade * 3)}</b>
        </li>
      </ul>

      <div className="lp-talao-accao">
        <button type="button" className="lp-btn lp-btn--larga" onClick={onInscrever}>
          Inscrever-me
        </button>
      </div>

      <p className="lp-talao-pe">
        Inscrição online em 2 minutos. A secretaria confirma a vaga no turno escolhido.
      </p>
    </aside>
  )
}
