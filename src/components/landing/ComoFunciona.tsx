const PASSOS = [
  {
    titulo: 'Escolhe o curso',
    texto: 'Veja a lista, a duração e a mensalidade. Pode inscrever-se em até 3 cursos ao mesmo tempo.',
  },
  {
    titulo: 'Preenche os dados',
    texto: 'Nome, WhatsApp, curso e turno. Leva dois minutos e não precisa de conta.',
  },
  {
    titulo: 'Anexa o BI e o recibo',
    texto: 'Foto do BI obrigatória. O comprovativo de pagamento é opcional se pagar na secretaria.',
  },
  {
    titulo: 'A secretaria confirma',
    texto: 'Recebe um número de inscrição e a secretaria confirma a vaga no turno escolhido.',
  },
]

/** Como funciona: quatro passos, sem promessas além do que acontece. */
export default function ComoFunciona() {
  return (
    <div className="lp-passos">
      {PASSOS.map((passo, indice) => (
        <div key={passo.titulo} className="lp-passo">
          <span className="lp-passo-num" aria-hidden>
            {indice + 1}
          </span>
          <h3 className="lp-passo-titulo">{passo.titulo}</h3>
          <p className="lp-passo-texto">{passo.texto}</p>
        </div>
      ))}
    </div>
  )
}
