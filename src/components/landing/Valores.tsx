interface Props {
  mensalidade: number
}

/** Valores: mensalidade, total do curso e formas de pagamento. */
export default function Valores({ mensalidade }: Props) {
  const moeda = (valor: number) => `${valor.toLocaleString('pt-PT')} MT`

  return (
    <div className="lp-valores">
      <div>
        <p className="lp-etiqueta">Valores</p>
        <h2 className="lp-h2">Quanto custa, sem letras pequenas.</h2>
        <p className="lp-sub" style={{ fontSize: '0.96rem' }}>
          Paga-se ao mês, durante os três meses do curso.
        </p>
      </div>

      <div>
        <ul className="lp-valores-lista">
          <li className="lp-valor">
            <span className="lp-valor-nome">Mensalidade</span>
            <span className="lp-valor-nota">Por mês, durante os 3 meses do curso</span>
            <span className="lp-valor-num">{moeda(mensalidade)}</span>
          </li>
          <li className="lp-valor">
            <span className="lp-valor-nome">Três mensalidades</span>
            <span className="lp-valor-nota">O valor de três meses de curso, pago ao mês</span>
            <span className="lp-valor-num">{moeda(mensalidade * 3)}</span>
          </li>
        </ul>
        <p className="lp-pagamentos">
          Pagamento por <strong>M-Pesa</strong>, <strong>e-Mola</strong> ou <strong>transferência</strong>, na
          secretaria. Pode anexar o comprovativo na inscrição ou entregá-lo depois.
        </p>
      </div>
    </div>
  )
}
