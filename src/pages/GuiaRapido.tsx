import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui'
import { usePerfil } from '../hooks/usePerfil'

/**
 * Guia rápido da secretaria — passos concretos para cada tarefa do dia-a-dia.
 * É conteúdo estático (funciona offline) e reflecte os botões reais da app.
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

  return (
    <>
      <PageHeader
        title="Guia rápido"
        subtitle="Passo a passo das tarefas do dia-a-dia da secretaria"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao emoji="🚀" titulo="Primeiros passos (apenas administrador)">
          <Passos
            itens={[
              <>
                Abra {pagina('/admin/configuracoes', 'Configurações')} e preencha o nome, contactos, endereço e o
                logotipo da instituição. Defina também o <strong>código de finanças</strong> (abre a área de
                Pagamentos) e os valores do certificado e da faixa.
              </>,
              <>
                Crie os cursos em {pagina('/admin/cursos', 'Cursos & Turmas')} — botão <strong>Novo curso</strong> —
                com nome, código, duração e valor da mensalidade.
              </>,
              <>
                Crie as turmas do curso (mesma página, separador de turmas): turno, número de vagas e ano lectivo.
              </>,
              <>
                Se necessário, crie contas para outras pessoas em {pagina('/admin/utilizadores', 'Utilizadores')} —
                papel <strong>Secretaria</strong> para o dia-a-dia.
              </>,
            ]}
          />
        </Cartao>

        <Cartao emoji="📝" titulo="Inscrições presenciais (secretaria)">
          <Passos
            itens={[
              <>
                Abra {pagina('/admin/inscricoes', 'Inscrições')} e clique em <strong>Nova Inscrição</strong> para
                registar o candidato (nome, BI, curso, turno).
              </>,
              'Na linha da inscrição, clique em Validar para abrir a ficha completa.',
              <>
                Valide cada documento anexado (botão <strong>Validar</strong> junto a cada documento).{' '}
                <strong>A aprovação fica bloqueada enquanto houver documentos por validar.</strong>
              </>,
              <>
                Clique em <strong>Aprovar Inscrição</strong> e escolha a turma para matricular de uma vez, ou aprove
                primeiro e matricule depois.
              </>,
              'O número de estudante é gerado automaticamente na matrícula.',
            ]}
          />
        </Cartao>

        <Cartao emoji="🌐" titulo="Candidaturas recebidas pelo site">
          <Passos
            itens={[
              <>
                Abra {pagina('/admin/candidaturas', 'Candidaturas Online')}. As submissões do site aparecem
                automaticamente (filtro "Do site").
              </>,
              'Clique na linha para ver os documentos anexados pelo candidato.',
              'Valide os documentos e depois clique em Aprovar ou Rejeitar (a rejeição exige motivo).',
              <>
                Link do formulário público para partilhar: <span className="font-mono text-xs">/inscricao</span> —
                também pode ser usado para consultar o estado de uma inscrição com o nº e o BI.
              </>,
            ]}
          />
        </Cartao>

        <Cartao emoji="💳" titulo="Pagamentos das mensalidades">
          <Passos
            itens={[
              <>
                Abra {pagina('/admin/pagamentos', 'Pagamentos')} e introduza o <strong>código de finanças</strong>{' '}
                (definido pelo administrador em Configurações). O acesso é guardado apenas nesta sessão.
              </>,
              <>
                No início de cada mês, o administrador clica em <strong>Gerar cobranças do mês</strong> — cria uma
                cobrança para cada aluno activo.
              </>,
              <>
                Quando o aluno pagar, clique em <strong>Registar pago</strong> (ou "Detalhes" para valor, método e
                referência). O <strong>recibo é impresso automaticamente</strong> após registar.
              </>,
              'Os botões "Recibo" reimprimem comprovativos a qualquer momento.',
            ]}
          />
        </Cartao>

        <Cartao emoji="🎓" titulo="Conclusão do curso e documentos finais">
          <Passos
            itens={[
              <>
                Na {pagina('/admin/alunos', 'Ficha do Aluno')}, marque o aluno como <strong>Concluído</strong>. O
                sistema aloca automaticamente o certificado e a faixa em{' '}
                {pagina('/admin/pos-conclusao', 'Pós-Conclusão')}.
              </>,
              <>
                Em Pós-Conclusão: <strong>Emitir</strong> o documento, <strong>Marcar pago</strong> (se aplicável) e{' '}
                <strong>Entregar</strong> ao aluno — o fluxo fica concluído.
              </>,
              'Os valores do certificado e da faixa são os definidos em Configurações.',
            ]}
          />
        </Cartao>

        <Cartao emoji="🌐⚡" titulo="App instalado, internet e offline">
          <Passos
            itens={[
              'O app pode ser instalado no computador (botão Instalar no canto). Com ícone próprio, abre como aplicativo.',
              <>
                <strong> Sem internet</strong>, o app abre com os últimos dados guardados. As alterações feitas offline
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
          Dicas de segurança: não partilhe o código de finanças; cada pessoa deve usar a sua própria conta; se alguém
          sair da instituição, o administrador pode redefinir a password ou desactivar o acesso em Utilizadores.
        </p>
      )}
    </>
  )
}
