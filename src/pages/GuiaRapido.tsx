import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui'
import { usePerfil } from '../hooks/usePerfil'

/**
 * Guia rápido — mostra só o que interessa a quem está a ler: a secretaria vê as
 * tarefas do balcão, o administrador vê também o arranque do sistema e as dicas
 * de segurança. É conteúdo estático (funciona offline) e escrito com os nomes
 * reais dos botões da app.
 */

function Passos({ itens }: { itens: (JSX.Element | string)[] }) {
  return (
    <ol className="mt-3 space-y-2">
      {itens.map((item, n) => (
        <li key={n} className="flex gap-3 text-sm text-ink">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-ink">
            {n + 1}
          </span>
          <span className="flex-1">{item}</span>
        </li>
      ))}
    </ol>
  )
}

function Cartao({
  titulo,
  emoji,
  children,
}: {
  titulo: string
  emoji: string
  children: React.ReactNode
}) {
  return (
    <section className="cell p-5">
      <h2 className="flex items-center gap-2 font-serif text-base font-semibold text-ink">
        <span aria-hidden>{emoji}</span>
        {titulo}
      </h2>
      {children}
    </section>
  )
}

const pagina = (to: string, label: string) => (
  <Link to={to} className="font-medium text-accent underline hover:text-accent-strong">
    {label}
  </Link>
)

export default function GuiaRapido() {
  const perfil = usePerfil()
  const isAdmin = perfil?.papel === 'admin'

  const subtitulo = isAdmin
    ? 'O essencial para a secretaria e o que é só da administração'
    : 'Passo a passo do dia-a-dia da secretaria'

  return (
    <>
      <PageHeader title="Guia rápido" subtitle={subtitulo} />

      <div className="grid gap-4 lg:grid-cols-2">
        {isAdmin && (
          <Cartao emoji="🚀" titulo="Arranque do sistema (só administrador)">
            <Passos
              itens={[
                <>
                  Em {pagina('/admin/configuracoes', 'Configurações')}, preencha o nome, contactos, endereço e
                  logotipo da instituição, o <strong>código de finanças</strong> (abre a área de Pagamentos) e os
                  valores do certificado e da faixa.
                </>,
                <>
                  Crie os cursos e as turmas em {pagina('/admin/cursos', 'Cursos & Turmas')} — botões{' '}
                  <strong>Novo curso</strong> e <strong>Nova turma</strong> (turno, vagas, ano lectivo).
                </>,
                <>
                  Crie as contas em {pagina('/admin/utilizadores', 'Utilizadores')}: papel <strong>Secretaria</strong>{' '}
                  para o balcão e, no separador <strong>Contas dos formadores</strong>, a conta de cada formador.
                </>,
                <>
                  Atribua o formador à turma em {pagina('/admin/pautas', 'Pautas & formadores')} e clique em{' '}
                  <strong>Abrir pauta</strong> quando for altura de lançar notas.
                </>,
              ]}
            />
          </Cartao>
        )}

        <Cartao emoji="📝" titulo="Inscrever alguém no balcão">
          <Passos
            itens={[
              <>
                Abra {pagina('/admin/inscricoes', 'Inscrições')} e clique em <strong>Nova Inscrição</strong> (nome,
                BI, data de nascimento, contactos, curso e turno).
              </>,
              <>
                A inscrição fica marcada como <strong>Presencial</strong> — aparece em Inscrições, não na lista de
                candidaturas vindas do site.
              </>,
              <>
                Na linha da inscrição, clique em <strong>Validar</strong> para abrir a ficha. Cada documento tem o seu
                botão <strong>Validar</strong>; <strong>a aprovação fica bloqueada enquanto houver documentos por
                validar</strong>.
              </>,
              <>
                Clique em <strong>Aprovar Inscrição</strong> e escolha a turma, ou use <strong>Aprovar + Matricular</strong>{' '}
                para fazer tudo de uma vez. O número de estudante é gerado na matrícula.
              </>,
            ]}
          />
        </Cartao>

        <Cartao emoji="🌐" titulo="Candidaturas recebidas pelo site">
          <Passos
            itens={[
              <>
                Abra {pagina('/admin/candidaturas', 'Candidaturas Online')} — o filtro <strong>Do site</strong> mostra
                quem se inscreveu sozinho pela página pública.
              </>,
              'Clique em Validar para ver a ficha e os documentos que o candidato anexou.',
              <>
                Valide os documentos e depois <strong>Aprovar</strong> ou <strong>Rejeitar</strong> (a rejeição exige
                motivo).
              </>,
            ]}
          />
        </Cartao>

        <Cartao emoji="📚" titulo="Notas e pautas (portal dos formadores)">
          <Passos
            itens={[
              <>
                Em {pagina('/admin/pautas', 'Pautas & formadores')}, escolha a turma, atribua o formador e clique em{' '}
                <strong>Abrir pauta</strong> — pode também definir um <strong>prazo</strong> de entrega.
              </>,
              <>
                Com a pauta aberta, o formador entra no portal dele (a conta dele) e lança as notas —{' '}
                <strong>uma linha de cada vez</strong> ou a pauta toda. Sem pauta aberta, ele não escreve.
              </>,
              <>
                Quando terminar, clique em <strong>Fechar</strong>: o formador passa a ver a pauta só para leitura.{' '}
                <strong>Reabrir</strong> volta a permitir alterações.
              </>,
              <>
                <strong>Exportar CSV</strong> em Pautas & formadores (e também no portal do formador) leva a pauta para
                papel ou Excel.
              </>,
              <>
                Na {pagina('/admin/alunos', 'Ficha do Aluno')}, <strong>Ver histórico</strong> mostra quem lançou ou
                alterou cada nota, quando e com que valores. Mesmo com a pauta fechada, podes sempre corrigir notas na
                ficha do aluno.
              </>,
            ]}
          />
        </Cartao>

        <Cartao emoji="💳" titulo="Mensalidades e recibos">
          <Passos
            itens={[
              <>
                Abra {pagina('/admin/pagamentos', 'Pagamentos')} e introduza o <strong>código de finanças</strong>. O
                acesso fica guardado apenas nesta sessão.
              </>,
              <>
                No início do mês, as cobranças são criadas com <strong>Gerar cobranças do mês</strong> — botão do
                administrador.
              </>,
              <>
                Quando o aluno pagar, clique em <strong>Registar pago</strong> (ou <strong>Detalhes</strong> para
                valor, método e referência). O <strong>recibo é impresso automaticamente</strong>.
              </>,
              'O botão Recibo reimprime comprovativos a qualquer momento.',
            ]}
          />
        </Cartao>

        <Cartao emoji="🎓" titulo="Fim do curso e documentos">
          <Passos
            itens={[
              <>
                Na {pagina('/admin/alunos', 'Ficha do Aluno')}, clique em{' '}
                <strong>Concluir curso</strong>. O certificado e a faixa ficam por emitir em{' '}
                {pagina('/admin/pos-conclusao', 'Pós-Conclusão')}.
              </>,
              <>
                Em Pós-Conclusão: <strong>Emitir</strong> o documento, <strong>Marcar pago</strong> (se aplicável) e{' '}
                <strong>Entregar</strong> ao aluno — o processo fica fechado.
              </>,
              'Para mudar alguém de turma, use Transferir de turma na ficha do aluno.',
            ]}
          />
        </Cartao>

        <Cartao emoji="📶" titulo="App instalado, internet e offline">
          <Passos
            itens={[
              'O app pode ser instalado no computador (botão Instalar no canto) e abre como aplicativo.',
              <>
                <strong> Sem internet</strong>, abre com os últimos dados guardados. As alterações feitas offline
                ficam numa fila e sincronizam sozinhas quando a ligação voltar — a bolinha no canto inferior esquerdo
                mostra o estado (âmbar = offline/pendentes, vermelho = falhas).
              </>,
              'O primeiro acesso (login) e o envio de ficheiros exigem internet.',
              'Se a bolinha indicar falhas de sincronização, toque nela para ver os motivos.',
            ]}
          />
        </Cartao>
      </div>

      {isAdmin && (
        <p className="mt-4 text-xs text-ink-faint">
          Só da administração: Configurações, Utilizadores, gerar cobranças do mês, abrir/fechar pautas e definir o
          código de finanças. Dicas de segurança: não partilhe o código de finanças; cada pessoa deve usar a sua
          própria conta; se alguém sair da instituição, redefina a password ou retire o acesso em Utilizadores.
        </p>
      )}
    </>
  )
}
