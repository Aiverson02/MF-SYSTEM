import type { LocalPublico } from '../../lib/catalogo'

interface Props {
  locais: LocalPublico[]
}

/** Link para o Google Maps por pesquisa — sem iframe e sem chave de API. */
function linkMapa(local: LocalPublico): string {
  const consulta = [local.nome, local.referencia].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`
}

export default function Localizacao({ locais }: Props) {
  return (
    <div className="lp-locais">
      {locais.map((local) => (
        <div key={local.id} className="lp-local">
          <h3 className="lp-local-nome">{local.nome}</h3>
          {local.referencia && <p className="lp-local-ref">{local.referencia}</p>}
          <a
            className="lp-local-mapa"
            href={linkMapa(local)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>Ver no mapa</span>
            <span aria-hidden>↗</span>
          </a>
        </div>
      ))}
    </div>
  )
}
