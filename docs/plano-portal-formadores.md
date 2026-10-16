# Plano — Portal dos Formadores (SIGA)

**Estado:** proposta para aprovação. Nada deste plano está implementado; o código
só avança depois da tua autorização e das decisões da secção 4.

**Objectivo:** dar aos formadores um acesso próprio, restrito e auditável, para
lançar as notas das avaliações e do exame dos alunos das suas turmas — sem lhes
abrir o painel da secretaria.

---

## 1. Âmbito

**Entra nesta fase**

- Conta própria por formador (email + palavra-passe), com papel `formador`.
- Portal mínimo, pensado para telemóvel: lista de pautas do formador e ecrã de
  lançamento de notas.
- Escrita validada no servidor (autorização, escala da nota, curso/turma).
- Fecho de pauta pela secretaria (depois de fechada, o formador não altera).
- Histórico de alterações às notas (quem, quando, valor anterior → novo).
- Gestão das contas de formador pela secretaria (criar, redefinir password,
  desactivar).

**Não entra (fica para depois, ver §12)**

- Portal do aluno, pauta imprimível/PDF, importação de notas por CSV, leitura
  offline no portal, exame de recurso / segunda época.

---

## 2. O que já existe e vai ser reaproveitado

| Peça | Onde | Estado |
|---|---|---|
| Tabela `formadores` (nome, especialidade, telefone, email, ativo) + separador de gestão | `supabase/migrations/004_*.sql`, [CursosTurmas.tsx](src/pages/CursosTurmas.tsx) | existe |
| Formador atribuído ao curso (`cursos.formador_id`) com select na UI | `004_*.sql`, [CursosTurmas.tsx:121](src/pages/CursosTurmas.tsx#L121) | existe |
| Catálogo de avaliações por curso + notas por aluno/item + validação de escala/curso + autoria (`lancado_por`) | [015_avaliacoes_notas.sql](supabase/migrations/015_avaliacoes_notas.sql) | **escrito, ainda por aplicar** |
| Fórmula da nota final numa só vista (`notas_resumo_aluno`) e limiar de aprovação (`nota_minima_aprovacao()`) | [015_avaliacoes_notas.sql](supabase/migrations/015_avaliacoes_notas.sql) | idem |
| Ligação formador ↔ conta de autenticação (`formadores.user_id`, única quando preenchida) | `015_*.sql`, secção H | idem |
| Papel em `app_metadata` (imutável pelo utilizador) + `eh_admin()` / `eh_staff()` | `014_hardening_seguranca.sql` | existe |
| Login por email/password, `usePerfil`, `RequireAuth`, `AdminGate`, Sidebar por papel | [Login.tsx](src/pages/Login.tsx), [usePerfil.ts](src/hooks/usePerfil.ts), [AdminGate.tsx](src/components/AdminGate.tsx) | existe |
| Camada offline (cache de leituras + fila de escritas) | [offline.ts](src/lib/offline.ts) | existe |
| CI: `npm audit` + typecheck + build + artefactos do PWA | [.github/workflows/ci.yml](.github/workflows/ci.yml) | existe |

Conclusão: falta sobretudo **autenticação com papel de formador**, **autorização
de escrita em notas limitada ao formador certo**, **estados de pauta** (aberta /
fechada) e **histórico**.

---

## 3. Lacunas a fechar

1. Não existe papel `formador` (hoje só `admin` e `secretaria`).
2. Nenhum registo diz que conta pertence a que formador — a coluna `user_id`
   existe desde a 015, mas está sempre vazia e nada a usa.
3. Não há forma de o formador lançar notas sem passar por RLS de secretaria
   (hoje `notas` é só `eh_staff()`).
4. Não há controlo temporal: qualquer pessoa com acesso escreve notas a qualquer
   momento, indefinidamente.
5. Não há histórico: uma nota alterada não deixa rasto (só se sabe quem lançou
   *por último*).
6. Um formador não deve ver Bilhete de Identidade, telefone, documentos nem
   finanças — hoje o caminho mais simples (dar-lhe `select` em `inscricoes`)
   abriria tudo isso. É preciso um caminho estreito.
7. `README.md` desactualizado e **perigoso**: manda criar utilizadores com
   `user_metadata = { "papel": ... }`, que a 014 passou para `app_metadata`.
   Contas criadas assim hoje ficam com papel no sítio errado: a UI mostra
   "Administrador" e o **servidor recusa tudo** (parece avaria, é segurança).

---

## 4. Decisões a aprovar (D1–D7)

### D1 — Como o formador entra
- **(a) Papel `formador` em `app_metadata` + email/palavra-passe criado pela secretaria** — *recomendado*: reutiliza tudo o que já existe, sem depender de SMTP configurado, e a criação da conta fica auditável.
- (b) Convite por email / magic link do Supabase — menos atrito de password, mas exige SMTP e controlo de *redirect URLs*; melhor como fase 2.
- (c) Reaproveitar contas de staff existentes — não isola pessoas nem responsabilidades; desaconselhado.

### D2 — Que alunos o formador pode lançar
- **(a) Por curso (`cursos.formador_id`, já existe)** — *recomendado para v1*: um curso tem um formador; é o que a escola já configura hoje.
- (b) Por turma (`turmas.formador_id`, nova coluna) — útil quando o mesmo curso tem turmas com formadores diferentes.
- (c) Vários formadores por curso (tabela de ligação) — mais flexível, mais UI e mais regras.

O desenho proposto (a) muda para (b) sem refazer nada: a autorização passa por
uma função (`turmas_do_formador()`) e a pauta já é por turma.

### D3 — Fecho da pauta
- **(a) Estados por pauta (turma + item): `aberta` / `fechada`, com data limite opcional** — *recomendado*: a secretaria abre o que o formador deve preencher e fecha quando termina; garante que nada muda antes de certificar.
- (b) Sempre editável — simples, mas notas podem mudar depois de emitidos certificados.
- (c) Submeter → validar pela secretaria (dupla assinatura por pauta) — mais controlo, mais cliques; proposta como evolução.

### D4 — Histórico de alterações
- **(a) Tabela `notas_historico` + trigger (insert/update/delete)** — *recomendado*: notas são registo académico; com formadores a lançar, o rasto passa a ser indispensável.
- (b) Manter só `lancado_por` / `lancado_em` — barato, mas perde o valor anterior e quem alterou.

### D5 — Offline no portal
- **(a) Portal online-only na v1** — *recomendado*: a fila offline guarda escritas em `localStorage` e reenvia depois; numa nota, "guardado" que afinal falha é pior do que um erro imediato.
- (b) Leitura em cache + escritas diferidas com revisão — fase 2.

### D6 — Onde a secretaria gere as contas
- **(a) Ligar/conta na aba "Formadores" (Cursos & Turmas) e redefinir password em "Utilizadores"** — *recomendado*: cada coisa no sítio onde já está o contexto.
- (b) Tudo em "Utilizadores" (lista de formadores sem conta + ações) — mais centralizado, duplica informação de formadores em dois ecrãs.

### D7 — Regras académicas (preciso que confirmes)
- Escala 0–20 e aprovação ≥ 10 — **já é o que está implementado** (muda-se num só sítio: `nota_minima_aprovacao()`).
- Exame com peso 2 (40% da nota final) — já é o padrão sugerido.
- **Exame de recurso / 2.ª época**: implementar agora ou deixar para depois? (v1 sugere-se deixar de fora.)
- **Quem lança o exame**: o formador do curso ou a secretaria? O que não for aberto pela secretaria (D3) não é preenchível pelo formador.

---

## 5. Modelo de dados proposto — migração `016_portal_formadores.sql`

```sql
-- 1. Pauta = (turma, item de avaliação). O que a secretaria abre ao formador.
create table public.pautas (
  id           uuid primary key default gen_random_uuid(),
  turma_id     uuid not null references public.turmas(id) on delete cascade,
  avaliacao_id uuid not null references public.avaliacoes(id) on delete cascade,
  estado       text not null default 'aberta' check (estado in ('aberta','fechada')),
  prazo        date,                      -- opcional: fecha sozinho depois desta data
  aberta_em    timestamptz not null default now(),
  aberta_por   uuid,
  fechada_em   timestamptz,
  fechada_por  uuid,
  unique (turma_id, avaliacao_id)         -- uma pauta por turma + item
);

-- 2. Registo académico: quem alterou o quê, quando, de que valor para que valor.
create table public.notas_historico (
  id             bigserial primary key,
  nota_id        uuid,
  aluno_id       uuid not null,
  avaliacao_id   uuid not null,
  accao          text not null check (accao in ('insert','update','delete')),
  nota_anterior  numeric(4,2),
  nota_nova      numeric(4,2),
  formador_id    uuid,
  quem           uuid,
  quando         timestamptz not null default now()
);
-- trigger AFTER INSERT/UPDATE/DELETE em public.notas → notas_historico
-- (a tabela é privada: sem grants, sem policies — só leitura por RPC de staff)

-- 3. Helpers de autorização (security definer, search_path fixo)
create function public.formador_actual() returns uuid;     -- formadores.id do auth.uid()
create function public.turmas_do_formador() returns setof uuid;

-- 4. RPCs do portal (nada de acesso directo às tabelas)
public.pautas_do_formador()                                  -- as minhas pautas + progresso
public.pauta_da_turma(p_turma_id uuid, p_avaliacao_id uuid)  -- alunos, nº, nome, nota, observações
public.guardar_notas_pauta(p_turma_id uuid, p_avaliacao_id uuid, p_notas jsonb)
                                                             -- devolve (sucesso, mensagem, lançados)
public.resumo_pauta(p_turma_id uuid)                         -- médias/estado por aluno (opcional)

-- 5. Contas de formador (admin/secretaria)
public.criar_conta_formador(p_formador_id uuid, p_email text, p_password text)
   -- cria/actualiza auth.users com app_metadata.papel='formador' e grava formadores.user_id
public.ligar_conta_formador(p_formador_id uuid, p_email text)
public.listar_formadores_com_conta()
```

`guardar_notas_pauta` valida, no servidor, tudo o que pode falhar:

- formador autenticado e dono do curso da turma (`cursos_do_formador()`);
- aluno pertence à turma; item pertence ao curso dessa turma;
- pauta existe e está `aberta` (e dentro do `prazo`, se definido);
- nota numérica dentro de `0 … nota_maxima`;
- tamanho do JSON limitado (anti-abuso, como nas RPCs da 014);
- grava `formador_id` = formador autenticado e deixa `lancado_por`/`lancado_em` ao trigger existente.

---

## 6. Segurança e privacidade

- **Nada de RLS largo para formadores.** Em vez de lhes dar `select` em
  `inscricoes`/`alunos_matriculados`, o portal fala apenas por RPCs `security
  definer` que devolvem o mínimo: número de estudante e **nome** (para o formador
  saber de quem é a nota). Bilhete de identidade, telefone, email, documentos,
  pagamentos e configurações ficam invisíveis.
- **`eh_staff()` continua falso para `formador`** (compara valores explícitos) —
  vai ficar com teste de regressão, para que um papel novo nunca herde poderes
  de secretaria por acidente.
- **Fecho obrigatório antes de certificar**: pauta fechada recusa escrita mesmo
  ao próprio formador; a mensagem diz porquê e quem fechou.
- **Histórico imutável**: `notas_historico` sem grants nem policies; leitura só
  por RPC de staff. Qualquer correcção posterior fica registada.
- **Contas individuais**: uma conta por formador, nunca partilhada; desactivar
  (`formadores.ativo = false`) corta o acesso sem apagar o histórico.
- **Sem `anon` novo**: nenhuma tabela/função desta fase é acessível sem sessão.
- Actualizar `SECURITY.md` (§ riscos residuais) e a § Segurança do `README.md`
  com o modelo de papéis `admin` / `secretaria` / `formador`.

---

## 7. Experiência do formador (UI)

- `/login` — mesma página; depois de entrar, encaminha por papel:
  `formador → /formador/pautas`, `secretaria/admin → /admin/dashboard`.
  `usePerfil` passa a reconhecer `formador`; novo guarda de rota (`RequirePapel`)
  impede que um formador chegue a `/admin/*` (e vice-versa).
- `/formador/pautas` — "As minhas pautas": curso, turma, item, estado
  (Aberta/Fechada), progresso `12/28`, prazo. Pensado para telemóvel: linhas
  grandes, sem gráficos.
- `/formador/pauta/:turmaId/:avaliacaoId` — grelha dos alunos (nº, nome, nota,
  observações) com "Guardar" fixo no fundo, contagem de "por preencher" e aviso
  claro quando a pauta está fechada, sem rede, ou quando uma nota sai da escala.
- `/formador/sumario` *(opcional)* — por turma: nota final e situação de cada
  aluno, quantos aprovados/reprovados; lê a mesma vista de resumo, portanto os
  números coincidem com os da secretaria.
- PWA: o `start_url` actual é `/admin/dashboard`. Proponho passá-lo a `/`, que
  encaminha por papel — o formador que instala a app aterra no portal e a
  secretaria no painel (actualização do service worker já é automática).

---

## 8. Fluxo completo (do lado da escola)

1. Secretaria cria o formador em **Cursos & Turmas → Formadores** e atribui-o ao curso.
2. Secretaria cria-lhe a conta (email + password temporária) e entrega-a.
3. Secretaria abre as pautas dos itens que ele deve preencher (avaliações; exame conforme D7).
4. Formador entra, lança as notas, corrige enquanto a pauta estiver aberta.
5. Secretaria vê o progresso, confere a nota final e fecha a pauta.
6. Depois de fechada: o formador só lê; qualquer correcção passa pela secretaria
   e fica no histórico.

---

## 9. Fases, com critérios de aceitação

| Fase | Conteúdo | Esforço | Critério de aceitação |
|---|---|---|---|
| **F0 — Higiene de acessos** | Corrigir `README.md` (migrations `001…016`, papel em `app_metadata`); verificação das contas existentes; teste de regressão de papéis | pequeno | Nenhuma conta de staff com papel só em `user_metadata`; papel `formador` não passa em `eh_staff()` nem em `eh_admin()` |
| **F1 — Migração 016** | Pautas, histórico, helpers, RPCs, contas | médio | Formador lança notas dos *seus* alunos; recusado fora do curso, com pauta fechada, com nota fora da escala e com JSON excessivo; toda a escrita fica no histórico |
| **F2 — Portal** | Rotas `/formador/*`, encaminhamento por papel, ecrãs de lista e lançamento | médio-grande | Formador A não vê nem altera nada do formador B; não vê BI/contactos/documentos/finanças; consegue lançar e corrigir enquanto aberta; nota final igual à do painel |
| **F3 — Operações da secretaria** | Abrir/fechar pautas, criar conta, redefinir password, desactivar | pequeno-médio | Ciclo completo: abrir → lançar → fechar → formador deixa de poder alterar, com mensagem explícita |
| **F4 — Opcional** | Exame de recurso, pauta imprimível/PDF, importação CSV, leitura offline | a decidir | A definir contigo antes de começar |

---

## 10. Testes e verificação

- **Testes de base de dados a sério, no CI**: mover o banco de ensaio que já usei
  (Postgres real em WASM, `@electric-sql/pglite`, com um esquema mínimo que emula
  o Supabase) para `supabase/tests/`, com script `npm run test:db` e um passo no
  [.github/workflows/ci.yml](.github/workflows/ci.yml). Cobre: fórmula da nota
  final, upsert, validações da 015 e — na F1 — autorização do formador, pauta
  fechada e isolamento entre formadores.
- **Verificação manual com duas contas** (formador A, formador B) em preview:
  isolamento, mensagens de erro, comportamento sem sessão.
- `tsc -b` + `npm run build` obrigatórios em cada fase (é o que o CI já faz).

---

## 11. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Formador com telemóvel fraco / ligação má | Portal leve, sem gráficos; escritas pequenas (uma pauta de cada vez); offline em fase posterior |
| Conta de formador partilhada entre colegas | Uma conta por pessoa + histórico com autoria; desactivar quando sai |
| Notas alteradas depois de certificados emitidos | Pauta fechada recusa escrita + histórico imutável |
| Formador a tentar ver dados de alunos alheios | RPCs com escopo no servidor (curso/turma) e campos mínimos; sem grants novos de leitura |
| `README` a induzir criação de contas com papel no sítio errado | F0 corrige a documentação e verifica as contas existentes |
| Modelo de um formador por curso não chegar | D2 define v1; a autorização passa por função, mudar depois é local |

---

## 12. Fora de âmbito (propostas seguintes)

1. Portal/área do aluno (notas e situação, consulta por nº de estudante + BI).
2. Pauta oficial imprimível (PDF) por turma, para arquivo e assinatura.
3. Exame de recurso / 2.ª época com regra explícita de substituição de nota.
4. Importação de notas por CSV (lançamento em massa no fim do módulo).
5. Leitura offline no portal do formador (notas em cache, escritas diferidas com revisão).

---

## 13. O que preciso de ti para avançar

1. **Aprovar (ou corrigir) D1–D7.**
2. **Aplicar a migração 015** no SQL Editor do Supabase — sem ela não há onde escrever notas.
3. Dizer-me **como as contas de staff foram criadas** (pelo painel "Utilizadores" ou à mão pelo README antigo) — se houver contas à mão, entram na correcção da F0.
4. Confirmar **regras académicas**: escala/limiar, peso do exame, se há recurso, e quem lança o exame.
5. Confirmar se **um curso pode ter mais de um formador** (D2).
6. Dizer se os formadores têm **email institucional** (para reposição de password) ou se preferes palavra-passe temporária entregue em mão.
