import { mensalidadeDe, type CursoPublico } from '../../lib/catalogo'

interface Props {
  cursos: CursoPublico[]
  cursoEscolhido: string | null
  onEscolher: (cursoId: string) => void
}

/** Lista densa (uma linha por formação), não cartões iguais. */
export default function TabelaCursos({ cursos, cursoEscolhido, onEscolher }: Props) {
  return (
    <div className="lp-cursos">
      {cursos.map((curso) => (
        <article
          key={curso.id}
          className="lp-curso"
          aria-current={cursoEscolhido === curso.id ? 'true' : undefined}
        >
          <div>
            <span className="lp-curso-nome">{curso.nome}</span>
            {curso.codigo && <span className="lp-curso-cod">{curso.codigo}</span>}
          </div>
          <p className="lp-curso-desc">{curso.descricao}</p>
          <span className="lp-curso-dur">{curso.duracao}</span>
          <span className="lp-curso-preco">
            <b>{mensalidadeDe(curso).toLocaleString('pt-PT')} MT</b>
            <span>por mês</span>
          </span>
          <button
            type="button"
            className="lp-curso-escolher"
            onClick={() => onEscolher(curso.id)}
            aria-label={`Inscrever-me em ${curso.nome}`}
          >
            <span aria-hidden>→</span>
          </button>
        </article>
      ))}
    </div>
  )
}
