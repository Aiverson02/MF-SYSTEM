/**
 * Testes das migrações 015 (avaliações e notas), 016 (portal dos formadores),
 * 017 (search_path de `nota_minima_aprovacao`), 018 (lista staff sem contas
 * de formador), 019 (endurecimento da revisão de segurança), 020 (origem da
 * inscrição decidida pela sessão), 021 (data do pagamento do certificado e da
 * faixa), 022 (semente do catálogo de cursos), 023 (limite de 3 inscrições
 * activas por aluno), 024 (inscrição sem BI e sem data de nascimento, com
 * identidade por nome+celular), 025 (apagar utilizador, só admin) e 026
 * (cobranças configuráveis: catálogo + aplicação a alunos).
 *
 * Correm num Postgres real embutido — sem Docker, sem internet e sem tocar no
 * projecto Supabase de produção:
 *
 *     npm run test:db
 *
 * Cobrem a fórmula da nota final (incluindo exame de recurso), as validações de
 * escala/curso, a autorização por formador e turma, o estado das pautas
 * (aberta/fechada/prazo), o histórico de alterações e a criação de contas.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { criarBanco, autenticar, semSessao } from './supabase-stub.mjs'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const MIGRACOES = path.join(AQUI, '..', 'migrations')
const FICHEIROS = [
  '015_avaliacoes_notas.sql',
  '016_portal_formadores.sql',
  '017_nota_minima_search_path.sql',
  '018_listar_staff_so_staff.sql',
  '019_endurecimento_revisao_seguranca.sql',
  '020_origem_inscricao_por_sessao.sql',
  '021_pos_conclusao_data_pagamento.sql',
  '022_seed_cursos_catalogo.sql',
  '023_limite_3_inscricoes_por_aluno.sql',
  '024_inscricao_sem_bi_e_data_nascimento.sql',
  '025_apagar_utilizador.sql',
  '026_cobrancas_configuraveis.sql',
]

// ---------------------------------------------------------------- ferramentas
let falhas = 0
let total = 0

function verificar(nome, condicao, extra = '') {
  total++
  if (!condicao) falhas++
  console.log(`${condicao ? '  OK   ' : '  FALHA'} ${nome}${extra ? `  [${extra}]` : ''}`)
}

function grupo(titulo) {
  console.log(`\n${titulo}`)
}

// ------------------------------------------------------------------- cenário
const cA = 'aaaaaaaa-0000-0000-0000-000000000001'
const cB = 'bbbbbbbb-0000-0000-0000-000000000002'
const tA1 = '11110000-0000-0000-0000-000000000001' // Curso A, manhã
const tA2 = '11110000-0000-0000-0000-000000000002' // Curso A, tarde
const tB = '22220000-0000-0000-0000-000000000001' // Curso B, manhã
const a1 = 'a1000000-0000-0000-0000-000000000001'
const a2 = 'a1000000-0000-0000-0000-000000000002'
const a3 = 'a1000000-0000-0000-0000-000000000003'
const a4 = 'a4000000-0000-0000-0000-000000000004'
const f1 = 'f1000000-0000-0000-0000-000000000001' // Ana — lecciona a turma da manhã
const f2 = 'f2000000-0000-0000-0000-000000000002' // Bento — lecciona a turma da tarde
const u2 = '02000000-0000-0000-0000-000000000002' // conta criada fora (painel Auth) e depois ligada
const uStaff = '03000000-0000-0000-0000-000000000003'
const uAdmin = '04000000-0000-0000-0000-000000000004'

const staff = { id: uStaff, papel: 'secretaria' }
const admin = { id: uAdmin, papel: 'admin' }

const db = await criarBanco()

grupo('Migrações')
try {
  for (const ficheiro of FICHEIROS) {
    await db.exec(fs.readFileSync(path.join(MIGRACOES, ficheiro), 'utf8'))
  }
  verificar(`${FICHEIROS.join(' + ')} aplicam sem erro`, true)
} catch (e) {
  verificar(`${FICHEIROS.join(' + ')} aplicam sem erro`, false, e.message)
  console.log('\nSem migrações não há nada a testar.')
  await db.close()
  process.exit(1)
}

/** Executa como um papel (null = sem sessão) e devolve as linhas. */
async function como(quem, sql, params) {
  if (quem === null) await semSessao(db)
  else await autenticar(db, quem)
  return (await db.query(sql, params)).rows
}

/** Uma RPC que deve recusar com `sucesso = false` e a mensagem à espera. */
async function recusa(quem, sql, params, padrao, nome) {
  const r = (await como(quem, sql, params))[0] ?? {}
  verificar(nome, r.sucesso === false && padrao.test(r.mensagem ?? ''), r.mensagem ?? JSON.stringify(r))
}

/** Uma instrução que deve falhar na base de dados (trigger/constraint). */
async function esperaErro(quem, sql, padrao, nome) {
  if (quem === null) await semSessao(db)
  else await autenticar(db, quem)
  try {
    await db.query(sql)
    verificar(nome, false, 'a base de dados aceitou a escrita')
  } catch (e) {
    verificar(nome, padrao.test(e.message ?? ''), e.message)
  }
}

// ------------------------------------------------------------------- semente
await db.exec(`
  insert into public.cursos (id, nome, codigo) values
    ('${cA}', 'Curso A', 'CA'), ('${cB}', 'Curso B', 'CB');

  insert into public.turmas (id, curso_id, nome_turma, turno, ano_lectivo, limite_vagas) values
    ('${tA1}', '${cA}', 'A-Manhã', 'manha'::public.turno, 2026, 30),
    ('${tA2}', '${cA}', 'A-Tarde', 'tarde'::public.turno, 2026, 30),
    ('${tB}',  '${cB}', 'B-Manhã', 'manha'::public.turno, 2026, 30);

  insert into public.inscricoes (id, numero_inscricao, nome_completo, numero_bi, data_nascimento, telefone_whatsapp, curso_id, turno_pretendido, estado) values
    ('${a1}', 'INS-2026-000001', 'Aluno Um',     '1101', '2005-01-01', '840000001', '${cA}', 'manha'::public.turno, 'aprovado'),
    ('${a2}', 'INS-2026-000002', 'Aluno Dois',   '1102', '2005-02-02', '840000002', '${cA}', 'manha'::public.turno, 'aprovado'),
    ('${a3}', 'INS-2026-000003', 'Aluno Três',   '1103', '2005-03-03', '840000003', '${cA}', 'tarde'::public.turno, 'aprovado'),
    ('${a4}', 'INS-2026-000004', 'Aluno Quatro', '1104', '2005-04-04', '840000004', '${cB}', 'manha'::public.turno, 'aprovado');

  insert into public.alunos_matriculados (id, inscricao_id, numero_estudante, turma_id) values
    ('${a1}', '${a1}', 'EST-001', '${tA1}'),
    ('${a2}', '${a2}', 'EST-002', '${tA1}'),
    ('${a3}', '${a3}', 'EST-003', '${tA2}'),
    ('${a4}', '${a4}', 'EST-004', '${tB}');

  insert into public.formadores (id, nome, ativo) values
    ('${f1}', 'Ana Formadora', true), ('${f2}', 'Bento Formador', true);

  insert into public.turma_formadores (turma_id, formador_id) values
    ('${tA1}', '${f1}'),
    ('${tA2}', '${f2}');

  -- Contas staff reais: as funções gravam auth.uid() (ex.: pago_por na 021),
  -- por isso o id usado no JWT dos testes tem de existir em auth.users.
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, created_at, updated_at) values
    ('${uStaff}', 'secretaria@exemplo.mz', 'x', '{"papel":"secretaria"}'::jsonb, now(), now()),
    ('${uAdmin}', 'admin@exemplo.mz', 'x', '{"papel":"admin"}'::jsonb, now(), now());
`)

// ===========================================================================
grupo('015 — catálogo de avaliações')

const padrao = await como(staff, `select * from public.criar_avaliacoes_padrao('${cA}')`)
verificar('secretaria cria 3 avaliações + exame', padrao[0]?.sucesso === true, padrao[0]?.mensagem)

const itensA = await como(staff, `select id, nome, tipo, peso, nota_maxima from public.avaliacoes where curso_id = '${cA}' order by ordem`)
verificar('4 itens no catálogo do curso A', itensA.length === 4, itensA.map((i) => i.nome).join(', '))

const [av1, av2, av3, exame] = itensA.map((i) => i.id)

verificar('exame tem peso 2 e escala 20', itensA[3].tipo === 'exame' && Number(itensA[3].peso) === 2 && Number(itensA[3].nota_maxima) === 20)

const definicao = (await como(staff, `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'avaliacoes_tipo_check'`))[0].def
verificar('tipos aceites: avaliacao, exame e recurso', /recurso/.test(definicao) && /exame/.test(definicao), definicao)

await como(staff, `
  insert into public.notas (aluno_id, avaliacao_id, nota) values
    ('${a1}', '${av1}', 15), ('${a1}', '${av2}', 14), ('${a1}', '${av3}', 16), ('${a1}', '${exame}', 12)
`)
let r1 = (await como(staff, `select * from public.notas_resumo_aluno where aluno_id = '${a1}'`))[0]
verificar('média das avaliações = 15,00', Number(r1.media_avaliacoes) === 15, String(r1.media_avaliacoes))
verificar('nota final ponderada = 13,80 (exame = 40%)', Number(r1.nota_final) === 13.8, String(r1.nota_final))
verificar('avaliação completa e aprovado', r1.avaliacao_completa === true && r1.aprovado === true)

await esperaErro(staff, `insert into public.notas (aluno_id, avaliacao_id, nota) values ('${a2}', '${av1}', 25)`,
  /fora do intervalo|máximo deste item/, 'nota acima da escala é recusada na escrita directa')

await como(staff, `
  insert into public.notas (aluno_id, avaliacao_id, nota) values ('${a1}', '${av1}', 20)
  on conflict (aluno_id, avaliacao_id) do update set nota = excluded.nota
`)
r1 = (await como(staff, `select * from public.notas_resumo_aluno where aluno_id = '${a1}'`))[0]
verificar('upsert regrava a nota (final 14,80)', Number(r1.nota_final) === 14.8, String(r1.nota_final))

// ===========================================================================
grupo('016 — exame de recurso')

await como(staff, `insert into public.avaliacoes (curso_id, nome, tipo, peso, ordem) values ('${cA}', 'Exame de Recurso', 'recurso', 2, 5)`)
const recurso = (await como(staff, `select id from public.avaliacoes where curso_id = '${cA}' and tipo = 'recurso'`))[0].id

await como(staff, `insert into public.notas (aluno_id, avaliacao_id, nota) values ('${a1}', '${recurso}', 15)`)
r1 = (await como(staff, `select * from public.notas_resumo_aluno where aluno_id = '${a1}'`))[0]
verificar('recurso melhor que o exame substitui-o (exame = 15,00)', Number(r1.nota_exame) === 15, String(r1.nota_exame))
verificar('nota do recurso visível em separado', Number(r1.nota_recurso) === 15, String(r1.nota_recurso))
// 20 + 14 + 16 + (exame efectivo 15 × peso 2) = 80 / 5 = 16,00
verificar('nota final recalculada com o exame efectivo (16,00)', Number(r1.nota_final) === 16, String(r1.nota_final))

await como(staff, `update public.notas set nota = 9 where aluno_id = '${a1}' and avaliacao_id = '${recurso}'`)
r1 = (await como(staff, `select * from public.notas_resumo_aluno where aluno_id = '${a1}'`))[0]
verificar('recurso pior que o exame é ignorado (exame = 12,00)', Number(r1.nota_exame) === 12, String(r1.nota_exame))
verificar('recurso continua visível (9,00)', Number(r1.nota_recurso) === 9, String(r1.nota_recurso))

await como(staff, `insert into public.notas (aluno_id, avaliacao_id, nota) values ('${a2}', '${recurso}', 14)`)
const r2 = (await como(staff, `select * from public.notas_resumo_aluno where aluno_id = '${a2}'`))[0]
verificar('recurso substitui exame ainda por lançar (exame = 14,00)', Number(r2.nota_exame) === 14, String(r2.nota_exame))

// ===========================================================================
grupo('016 — contas de formador')

const contaAna = await como(admin, `select * from public.criar_conta_formador('${f1}', 'ana@exemplo.mz', 'palavra-passe-1')`)
verificar('admin cria conta da formadora Ana', contaAna[0]?.sucesso === true, contaAna[0]?.mensagem)

// A conta recebe um id próprio no Supabase (auth.users), gerado pela RPC:
// lemos o id real do registo do formador em vez de o assumir.
const u1 = (await como(admin, `select user_id from public.formadores where id = '${f1}'`))[0].user_id
verificar('id da conta vem do registo do formador', typeof u1 === 'string' && u1.length === 36, String(u1))

// alternativa documentada: conta criada fora (painel Auth) e depois ligada
await como(admin, `insert into auth.users (id, email, encrypted_password, raw_app_meta_data, created_at, updated_at) values ('${u2}', 'bento@exemplo.mz', 'x', '{}'::jsonb, now(), now())`)
const ligada = await como(admin, `select * from public.ligar_conta_formador('${f2}', 'bento@exemplo.mz')`)
verificar('ligar conta existente funciona', ligada[0]?.sucesso === true, ligada[0]?.mensagem)

const formadorAna = { id: u1, papel: 'formador' }
const formadorBento = { id: u2, papel: 'formador' }

verificar('conta criada fica ligada ao registo do formador', (await como(admin, `select user_id from public.formadores where id = '${f1}'`))[0].user_id === u1)
verificar('eh_formador() verdadeiro para Ana', (await como(formadorAna, `select public.eh_formador() as v`))[0].v === true)
verificar('eh_staff() falso para formador', (await como(formadorAna, `select public.eh_staff() as v`))[0].v === false)
verificar('formador_actual() = Ana', (await como(formadorAna, `select public.formador_actual() as v`))[0].v === f1)
verificar('papel do formador vive em app_metadata', (await como(admin, `select raw_app_meta_data ->> 'papel' as papel from auth.users where id = '${u1}'`))[0].papel === 'formador')
verificar('identidade de email criada para o login', (await como(admin, `select 1 from auth.identities where user_id = '${u1}' and provider = 'email'`)).length === 1)
verificar('password guardada com hash, não em claro', (await como(admin, `select encrypted_password <> 'palavra-passe-1' as ok from auth.users where id = '${u1}'`))[0].ok === true)
verificar('ligar conta grava o papel formador', (await como(admin, `select raw_app_meta_data ->> 'papel' as papel from auth.users where id = '${u2}'`))[0].papel === 'formador')

// ===========================================================================
grupo('016 — pautas: quem pode lançar')

verificar('pautas_do_formador() vazio antes de abrir pautas', (await como(formadorAna, `select * from public.pautas_do_formador()`)).length === 0)

await recusa(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a1}","nota":10}]'::jsonb)`, [],
  /não foi aberta/, 'sem pauta aberta, o formador não escreve')

await como(staff, `insert into public.pautas (turma_id, avaliacao_id) values ('${tA1}', '${av1}')`)
const pauta = (await como(staff, `select * from public.pautas where turma_id = '${tA1}' and avaliacao_id = '${av1}'`))[0]
verificar('pauta registada como aberta', pauta.estado === 'aberta')
verificar('quem abriu fica registado (secretaria)', pauta.aberta_por === uStaff, String(pauta.aberta_por))

const aVe = (await como(formadorAna, `select * from public.pautas_do_formador()`))[0]
verificar('Ana vê a pauta da sua turma (2 alunos)', aVe?.item === 'Avaliação 1' && Number(aVe?.total_alunos) === 2, JSON.stringify({ item: aVe?.item, alunos: aVe?.total_alunos }))
verificar('pauta aberta é editável', aVe.pode_editar === true)
verificar('Bento não vê a pauta da turma da manhã', (await como(formadorBento, `select * from public.pautas_do_formador()`)).length === 0)

let gravado = await como(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a1}","nota":18,"observacoes":"boa"},{"aluno_id":"${a2}","nota":11}]'::jsonb)`)
verificar('Ana grava 2 notas de uma vez', gravado[0]?.sucesso === true && Number(gravado[0]?.guardadas) === 2, gravado[0]?.mensagem)

const gravadas = await como(staff, `select aluno_id, nota, observacoes, formador_id, lancado_por from public.notas where avaliacao_id = '${av1}' and aluno_id in ('${a1}','${a2}') order by aluno_id`)
verificar('nota gravada com o valor indicado', Number(gravadas.find((n) => n.aluno_id === a1)?.nota) === 18)
verificar('autoria = formador + conta que lançou', gravadas.every((n) => n.formador_id === f1 && n.lancado_por === u1))

await recusa(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a1}","nota":25}]'::jsonb)`, [],
  /fora do intervalo/, 'nota acima da escala é recusada')
await recusa(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a3}","nota":10}]'::jsonb)`, [],
  /não pertence a esta turma/, 'aluno de outra turma é recusado')
await recusa(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${recurso}', '[{"aluno_id":"${a1}","nota":10}]'::jsonb)`, [],
  /não foi aberta/, 'item sem pauta própria é recusado')
await recusa(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a1}","nota":"quinze"}]'::jsonb)`, [],
  /Nota inválida|inválid/, 'nota com texto é recusada com mensagem clara')

await recusa(formadorBento, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a1}","nota":10}]'::jsonb)`, [],
  /Não lecciona esta turma/, 'formador de outra turma não escreve')
verificar('Bento não lê a pauta da turma da manhã', (await como(formadorBento, `select * from public.pauta_da_turma('${tA1}', '${av1}')`)).length === 0)
verificar('Ana lê a pauta da sua turma (2 alunos)', (await como(formadorAna, `select * from public.pauta_da_turma('${tA1}', '${av1}')`)).length === 2)
verificar('secretaria lê qualquer pauta', (await como(staff, `select * from public.pauta_da_turma('${tA2}', '${av1}')`)).length === 1)

gravado = await como(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a2}","nota":null}]'::jsonb)`)
verificar('nota esvaziada é apagada', gravado[0]?.sucesso === true &&
  (await como(staff, `select 1 from public.notas where aluno_id = '${a2}' and avaliacao_id = '${av1}'`)).length === 0)

await como(staff, `update public.pautas set formador_id = '${f2}' where turma_id = '${tA1}' and avaliacao_id = '${av1}'`)
await recusa(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a1}","nota":10}]'::jsonb)`, [],
  /atribuída a outro formador/, 'pauta atribuída a outro formador é recusada')

await como(staff, `update public.pautas set formador_id = null, estado = 'fechada' where turma_id = '${tA1}' and avaliacao_id = '${av1}'`)
const fechada = (await como(staff, `select * from public.pautas where turma_id = '${tA1}' and avaliacao_id = '${av1}'`))[0]
verificar('fecho registado com autor e data', fechada.fechada_por === uStaff && fechada.fechada_em !== null)
verificar('pauta fechada não é editável', (await como(formadorAna, `select pode_editar from public.pautas_do_formador()`))[0].pode_editar === false)
await recusa(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a1}","nota":10}]'::jsonb)`, [],
  /Pauta fechada/, 'pauta fechada recusa escrita')

await como(staff, `update public.pautas set estado = 'aberta' where turma_id = '${tA1}' and avaliacao_id = '${av1}'`)
const reaberta = (await como(staff, `select * from public.pautas where turma_id = '${tA1}' and avaliacao_id = '${av1}'`))[0]
verificar('reabrir limpa o fecho anterior', reaberta.fechada_em === null && reaberta.aberta_por === uStaff)

await como(staff, `update public.pautas set prazo = current_date - 1 where turma_id = '${tA1}' and avaliacao_id = '${av1}'`)
await recusa(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a1}","nota":10}]'::jsonb)`, [],
  /prazo/, 'pauta fora do prazo recusa escrita')
await como(staff, `update public.pautas set prazo = null`)

await recusa(null, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '[{"aluno_id":"${a1}","nota":10}]'::jsonb)`, [],
  /Apenas formadores/, 'sem sessão não se lançam notas')

const lote = JSON.stringify(Array.from({ length: 501 }, () => ({ aluno_id: a1, nota: 10 })))
await recusa(formadorAna, `select * from public.guardar_notas_pauta('${tA1}', '${av1}', '${lote}'::jsonb)`, [],
  /Demasiadas notas/, 'lote excessivo é recusado')

// ===========================================================================
grupo('016 — histórico de notas')

const hist = await como(staff, `select * from public.historico_notas_aluno('${a1}') where item = 'Avaliação 1' order by quando desc`)
verificar('histórico tem entradas da Avaliação 1', hist.length >= 2, `${hist.length} entrada(s)`)
verificar('histórico distingue insert de update', hist.some((h) => h.accao === 'insert') && hist.some((h) => h.accao === 'update'))
verificar('histórico guarda valor anterior e novo', hist.some((h) => h.nota_anterior !== null && h.nota_nova !== null))
verificar('histórico identifica a conta que lançou', hist.some((h) => h.autor === 'ana@exemplo.mz'), hist[0]?.autor)
verificar('histórico identifica o formador', hist.some((h) => h.formador === 'Ana Formadora'))
verificar('formador não lê o histórico', (await como(formadorAna, `select * from public.historico_notas_aluno('${a1}')`)).length === 0)

const apagadas = await como(staff, `select * from public.historico_notas_aluno('${a2}') where accao = 'delete'`)
verificar('apagar uma nota fica registado', apagadas.length >= 1, `${apagadas.length} entrada(s)`)

// ===========================================================================
grupo('016 — resumo da turma')

const resumoAna = await como(formadorAna, `select * from public.resumo_turma('${tA1}')`)
verificar('Ana vê os 2 alunos da sua turma', resumoAna.length === 2, `${resumoAna.length} aluno(s)`)
verificar('resumo traz nome e número de estudante', resumoAna.some((r) => r.nome_completo === 'Aluno Um' && r.numero_estudante === 'EST-001'))
verificar('resumo não expõe BI nem telefone', !('numero_bi' in resumoAna[0]) && !('telefone_whatsapp' in resumoAna[0]))
verificar('Bento não vê a turma da manhã', (await como(formadorBento, `select * from public.resumo_turma('${tA1}')`)).length === 0)
verificar('Bento vê a sua turma', (await como(formadorBento, `select * from public.resumo_turma('${tA2}')`)).length === 1)
verificar('secretaria vê qualquer turma', (await como(staff, `select * from public.resumo_turma('${tA2}')`)).length === 1)
verificar('curso sem avaliações definidas não tem resumo (nada a lançar)',
  (await como(staff, `select * from public.resumo_turma('${tB}')`)).length === 0)

// ===========================================================================
grupo('016 — regras de acesso a contas')

await recusa(admin, `select * from public.criar_conta_formador('${f1}', 'ana@exemplo.mz', 'palavra-passe-3')`, [],
  /Já existe uma conta/, 'email duplicado é recusado')
await recusa(admin, `select * from public.criar_conta_formador('${f1}', 'nova@exemplo.mz', 'curta')`, [],
  /pelo menos 8/, 'password curta é recusada')
await recusa(staff, `select * from public.criar_conta_formador('${f1}', 'outra@exemplo.mz', 'palavra-passe-4')`, [],
  /Apenas o admin/, 'secretaria não cria contas de formador')
await recusa(admin, `select * from public.ligar_conta_formador('${f2}', 'ninguem@exemplo.mz')`, [],
  /Não existe nenhuma conta/, 'ligar a email inexistente é recusado')

const lista = await como(staff, `select * from public.listar_formadores_contas()`)
verificar('secretaria vê os formadores e as contas ligadas', lista.length === 2 && lista.every((f) => f.user_id !== null), `${lista.length} formador(es)`)

// Correcção do bug da 014: `criar_utilizador_staff` chamava uma função inexistente
// (jsonb_array_build_text) e falhava sempre em execução.
const novoStaff = await como(admin, `select * from public.criar_utilizador_staff('nova.secretaria@exemplo.mz', 'palavra-passe-9', 'secretaria')`)
verificar('criar_utilizador_staff funciona (correcção da 014)', novoStaff[0]?.sucesso === true, novoStaff[0]?.mensagem)
verificar('staff novo tem papel em app_metadata', (await como(admin, `select raw_app_meta_data ->> 'papel' as papel from auth.users where email = 'nova.secretaria@exemplo.mz'`))[0].papel === 'secretaria')
verificar('papel não é escrito em user_metadata', (await como(admin, `select coalesce(raw_user_meta_data ->> 'papel', '') = '' as ok from auth.users where email = 'nova.secretaria@exemplo.mz'`))[0].ok === true)

// ===========================================================================
grupo('016 — permissões e políticas')

const perms = (await db.query(`
  select
    has_table_privilege('anon', 'public.pautas', 'SELECT')                as anon_pautas,
    has_table_privilege('anon', 'public.turma_formadores', 'SELECT')      as anon_turma_formadores,
    has_table_privilege('anon', 'public.notas_historico', 'SELECT')       as anon_historico,
    has_table_privilege('anon', 'public.notas', 'SELECT')                 as anon_notas,
    has_table_privilege('anon', 'public.notas_resumo_aluno', 'SELECT')    as anon_vista,
    has_table_privilege('authenticated', 'public.pautas', 'SELECT,INSERT,UPDATE,DELETE') as auth_pautas,
    has_table_privilege('authenticated', 'public.turma_formadores', 'SELECT,INSERT,DELETE') as auth_turma_formadores,
    has_table_privilege('authenticated', 'public.notas_historico', 'SELECT') as auth_historico
`)).rows[0]

verificar('anon sem acesso a pautas, atribuições, notas e vista',
  perms.anon_pautas === false && perms.anon_turma_formadores === false && perms.anon_notas === false && perms.anon_vista === false)
verificar('anon sem acesso ao histórico', perms.anon_historico === false)
verificar('authenticated gere pautas e atribuições', perms.auth_pautas === true && perms.auth_turma_formadores === true)
verificar('histórico não é legível directamente (só por RPC)', perms.auth_historico === false)

const politicas = (await db.query(`
  select tablename, policyname, roles::text as roles
    from pg_policies
   where schemaname = 'public' and tablename in ('pautas', 'turma_formadores')
   order by tablename
`)).rows
verificar('pautas e turma_formadores: 1 política cada, só authenticated',
  politicas.length === 2 && politicas.every((p) => /authenticated/.test(p.roles)),
  politicas.map((p) => `${p.tablename}/${p.policyname}`).join(', '))

const funcoes = (await db.query(`
  select
    has_function_privilege('anon', 'public.formador_actual()', 'EXECUTE')                          as anon_formador_actual,
    has_function_privilege('anon', 'public.guardar_notas_pauta(uuid,uuid,jsonb)', 'EXECUTE')       as anon_guardar,
    has_function_privilege('authenticated', 'public.guardar_notas_pauta(uuid,uuid,jsonb)', 'EXECUTE') as auth_guardar,
    has_function_privilege('authenticated', 'public.registar_historico_nota()', 'EXECUTE')         as auth_trigger_fn
`)).rows[0]
verificar('anon não executa as RPCs do portal', funcoes.anon_guardar === false && funcoes.anon_formador_actual === false)
verificar('authenticated executa as RPCs do portal', funcoes.auth_guardar === true)
verificar('função de trigger não é chamável pela API', funcoes.auth_trigger_fn === false)

const opcoesVista = (await db.query(`select coalesce(array_to_string(reloptions, ','), '') as o from pg_class where relname = 'notas_resumo_aluno'`)).rows[0]
verificar('vista de resumo mantém security_invoker', /security_invoker=on/.test(opcoesVista.o), opcoesVista.o)

// ===========================================================================
grupo('017/018 — higiene das migrações seguintes')

// 017: o advisor do Supabase sinalizava esta função sem search_path fixo.
const cfgNota = (await db.query(`
  select coalesce(array_to_string(proconfig, ','), '') as o
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nota_minima_aprovacao'
`)).rows[0]
verificar('017: nota_minima_aprovacao tem search_path fixo', /search_path/.test(cfgNota?.o ?? ''), cfgNota?.o)

// 018: a lista staff mostrava as contas de FORMADOR como se fossem secretaria
// (e deixava o select de papel activo para essas linhas).
const staffLista = await como(admin, `select email, papel from public.listar_utilizadores_staff()`)
verificar('018: contas de formador ficam fora da lista staff',
  !staffLista.some((u) => u.email === 'ana@exemplo.mz' || u.email === 'bento@exemplo.mz'),
  staffLista.map((u) => u.email).join(', '))
verificar('018: lista staff mantém a secretaria criada',
  staffLista.some((u) => u.email === 'nova.secretaria@exemplo.mz' && u.papel === 'secretaria'))
verificar('018: só papéis staff na lista',
  staffLista.length > 0 && staffLista.every((u) => u.papel === 'admin' || u.papel === 'secretaria'))

// ===========================================================================
grupo('019 — endurecimento da revisão de segurança')

// A. O catálogo público de formadores deixou de expor contacto pessoal. Antes,
//    `anon` tinha SELECT na tabela inteira: GET /rest/v1/formadores?select=
//    email,telefone devolvia 200 com os dados (confirmado em produção).
const anonFormadores = (await db.query(`
  select
    has_table_privilege('anon', 'public.formadores', 'SELECT')                        as tabela,
    has_column_privilege('anon', 'public.formadores', 'email', 'SELECT')              as email,
    has_column_privilege('anon', 'public.formadores', 'telefone', 'SELECT')           as telefone,
    has_column_privilege('anon', 'public.formadores', 'nome', 'SELECT')               as nome,
    has_column_privilege('anon', 'public.formadores', 'especialidade', 'SELECT')      as especialidade
`)).rows[0]
verificar('019: anon sem SELECT na tabela de formadores', anonFormadores.tabela === false)
verificar('019: anon não lê email nem telefone dos formadores', anonFormadores.email === false && anonFormadores.telefone === false)
verificar('019: anon continua a ler o catálogo (nome e especialidade)', anonFormadores.nome === true && anonFormadores.especialidade === true)
verificar('019: secretaria continua a ler os contactos (select *)',
  (await db.query(`select has_table_privilege('authenticated', 'public.formadores', 'SELECT') as ok`)).rows[0].ok === true)

// B. A lista de contas staff só responde a quem é staff. Antes bastava estar
//    autenticado — um formador listava os emails da secretaria e do admin.
verificar('019: formador não lista as contas staff',
  (await como(formadorAna, `select * from public.listar_utilizadores_staff()`)).length === 0)
verificar('019: sem sessão não lista contas staff',
  (await como(null, `select * from public.listar_utilizadores_staff()`)).length === 0)
verificar('019: secretaria continua a ver a lista',
  (await como(staff, `select * from public.listar_utilizadores_staff()`)).length > 0)

// C. Papel auto-declarado em `user_metadata` (campo que o próprio utilizador
//    escreve via auth.updateUser) não promove ninguém.
const formadorComSpoof = { id: u2, papel: 'formador', metaUtilizador: { papel: 'admin' } }
verificar('019: eh_admin() ignora user_metadata.papel',
  (await como(formadorComSpoof, `select public.eh_admin() as v`))[0].v === false)
verificar('019: spoof de user_metadata não abre a lista staff',
  (await como(formadorComSpoof, `select * from public.listar_utilizadores_staff()`)).length === 0)

// Conta criada fora do painel (app_metadata vazio) com papel declarado às
// escondidas em user_metadata: na lista aparece como 'secretaria' (o default),
// nunca como o papel que ela própria escreveu.
const u3 = '05000000-0000-0000-0000-000000000005'
await como(admin, `insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('${u3}', 'conta.externa@exemplo.mz', 'x', '{}'::jsonb, '{"papel":"admin"}'::jsonb, now(), now())`)
const listaComSpoof = await como(admin, `select email, papel from public.listar_utilizadores_staff()`)
const externa = listaComSpoof.find((u) => u.email === 'conta.externa@exemplo.mz')
verificar('019: papel declarado em user_metadata nunca aparece como admin',
  externa?.papel === 'secretaria', String(externa?.papel))
verificar('019: conta de formador continua fora da lista staff',
  !listaComSpoof.some((u) => u.email === 'bento@exemplo.mz' || u.email === 'ana@exemplo.mz'))

// ===========================================================================
grupo('020 — origem da inscrição decide-se pela sessão')

// O botão *Nova Inscrição* do painel usa o mesmo formulário do site, que grava
// pela RPC pública. Antes, tudo o que passava por ali ficava marcado como
// 'online' — e uma inscrição registada à mão aparecia no grupo "Do site".
const rStaff = await como(staff, `
  select * from public.submeter_inscricao_publica('Aluno Balcao', 'BI-999', '2004-05-05', 'M', null, '840000999', '${cA}', 'manha'::public.turno)
`)
verificar('020: secretaria consegue registar a inscrição', !!rStaff[0]?.numero_inscricao, JSON.stringify(rStaff[0]))
verificar('020: inscrição registada pela secretaria fica presencial',
  (await como(staff, `select origem from public.inscricoes where numero_inscricao = '${rStaff[0]?.numero_inscricao}'`))[0]?.origem === 'presencial',
  String(rStaff[0]?.numero_inscricao))

const rAnon = await como(null, `
  select * from public.submeter_inscricao_publica('Aluno Site', 'BI-998', '2004-06-06', 'F', 'site@exemplo.mz', '840000998', '${cA}', 'manha'::public.turno)
`)
verificar('020: inscrição feita no site continua online',
  (await como(staff, `select origem from public.inscricoes where numero_inscricao = '${rAnon[0]?.numero_inscricao}'`))[0]?.origem === 'online',
  String(rAnon[0]?.numero_inscricao))

const rForm = await como(formadorAna, `
  select * from public.submeter_inscricao_publica('Aluno Formador', 'BI-997', '2004-07-07', 'M', null, '840000997', '${cA}', 'manha'::public.turno)
`)
verificar('020: conta de formador não é tratada como balcão da secretaria',
  (await como(staff, `select origem from public.inscricoes where numero_inscricao = '${rForm[0]?.numero_inscricao}'`))[0]?.origem === 'online',
  String(rForm[0]?.numero_inscricao))

// ===========================================================================
grupo('021 — pós-conclusão: data do pagamento')

// Sem data não há como atribuir o valor a um mês: a página de Pagamentos
// trabalha por mês, e o certificado pago não aparecia em lado nenhum.
const novoPos = await como(staff, `
  insert into public.pos_conclusao (aluno_id, item, valor) values ('${a2}', 'certificado', 350)
  returning id, data_pagamento
`)
const idPos = novoPos[0]?.id
verificar('021: item nasce por pagar e sem data', novoPos[0]?.data_pagamento === null, String(novoPos[0]?.data_pagamento))

const marcado = await como(staff, `
  update public.pos_conclusao set pago = true where id = '${idPos}'
  returning data_pagamento = current_date as data_ok, pago_por
`)
verificar('021: marcar pago grava a data de hoje', marcado[0]?.data_ok === true, String(marcado[0]?.data_ok))
verificar('021: fica registado quem registou o pagamento', marcado[0]?.pago_por === uStaff, String(marcado[0]?.pago_por))

const porMes = await como(staff, `
  select coalesce(sum(valor), 0) as total
    from public.pos_conclusao
   where pago
     and data_pagamento >= date_trunc('month', current_date)::date
     and data_pagamento <  (date_trunc('month', current_date) + interval '1 month')::date
`)
verificar('021: o valor passa a contar no mês do pagamento', Number(porMes[0]?.total) === 350, String(porMes[0]?.total))

const semData = (await como(staff, `select data_pagamento from public.pos_conclusao where id = '${idPos}'`))[0]?.data_pagamento
await como(staff, `update public.pos_conclusao set valor = 400 where id = '${idPos}'`)
const depoisDaEdicao = (await como(staff, `select data_pagamento from public.pos_conclusao where id = '${idPos}'`))[0]?.data_pagamento
verificar('021: editar a linha não reescreve a data do pagamento', String(semData) === String(depoisDaEdicao))

const desfeito = await como(staff, `
  update public.pos_conclusao set pago = false where id = '${idPos}'
  returning data_pagamento, pago_por
`)
verificar('021: desfazer o pagamento limpa data e autor',
  desfeito[0]?.data_pagamento === null && desfeito[0]?.pago_por === null,
  JSON.stringify(desfeito[0]))

verificar('021: função do trigger não é chamável pela API',
  (await db.query(`select has_function_privilege('authenticated', 'public.registar_pagamento_pos_conclusao()', 'EXECUTE') as ok`)).rows[0].ok === false)
verificar('021: função do trigger tem search_path fixo',
  /search_path/.test((await db.query(`
    select coalesce(array_to_string(proconfig, ','), '') as o
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registar_pagamento_pos_conclusao'
  `)).rows[0]?.o ?? ''))

// ===========================================================================
grupo('022 — semente do catálogo de cursos')

const CODIGOS_NOVOS = ['ATC-CC','BEL-EST','CON-G','CUL-DSB','EDU-INF','ELET-INS','GRH','MEST-CER','ING','JORNAL','SEC-EX','NOC-RP','DES-VE','IMP-EXP']
const contarSeed = async () => (await db.query(
  `select count(*)::int as n from public.cursos where codigo = any($1)`,
  [`{${CODIGOS_NOVOS.join(',')}}`],
)).rows[0].n
verificar('022: os 14 cursos pedidos foram inseridos', (await contarSeed()) === 14, String(await contarSeed()))
await db.exec(fs.readFileSync(path.join(MIGRACOES, '022_seed_cursos_catalogo.sql'), 'utf8'))
verificar('022: re-executar a semente não duplica cursos', (await contarSeed()) === 14, String(await contarSeed()))

// ===========================================================================
grupo('023 — limite de 3 inscrições activas por aluno (BI)')

// Dois cursos extra com id fixo: as 14 linhas da 022 têm UUIDs gerados e não
// servem para referenciar aqui.
const cC = 'cccccccc-0000-0000-0000-000000000003'
const cD = 'dddddddd-0000-0000-0000-000000000004'
await db.exec(`
  insert into public.cursos (id, nome, codigo) values
    ('${cC}', 'Curso C', 'CC'), ('${cD}', 'Curso D', 'CD');
`)

/**
 * Insert de teste: id e número únicos por chamada (TST-n não mexe na série INS).
 * Nome e celular derivam do BI: desde a 024 a identidade é BI **ou**
 * nome+celular, e linhas com o mesmo nome+celular seriam o mesmo "aluno".
 */
let tst = 0
const novaInsc = (bi, curso, estado) => {
  tst++
  const id = `e3000000-0000-0000-0000-${String(tst).padStart(12, '0')}`
  return `
    insert into public.inscricoes (id, numero_inscricao, nome_completo, numero_bi, data_nascimento, telefone_whatsapp, curso_id, turno_pretendido, estado)
    values ('${id}', 'TST-${tst}', 'Aluno ${bi}', '${bi}', '2004-01-01', '84000${bi}', '${curso}', 'manha'::public.turno, '${estado}')
  `
}

// Três cursos distintos passam — todos os estados não-rejeitados contam.
await como(staff, novaInsc('3301', cA, 'pendente'))
await como(staff, novaInsc('3301', cB, 'aprovado'))
await como(staff, novaInsc('3301', cC, 'em_analise'))
verificar('023: um BI com 3 inscrições activas em cursos distintos é aceite',
  (await db.query(`select count(*)::int as n from public.inscricoes where upper(numero_bi) = '3301'`)).rows[0].n === 3)

await esperaErro(staff, novaInsc('3301', cD, 'pendente'), /Limite de inscrições atingido/,
  '023: a 4ª inscrição activa do mesmo BI é recusada')

// Duplicado do mesmo curso (outro BI, só 1 activa — o limite ainda não chegou)
await como(staff, novaInsc('3302', cA, 'pendente'))
await esperaErro(staff, novaInsc('3302', cA, 'pendente'), /Já existe uma inscrição activa/,
  '023: repetir o mesmo curso com o mesmo BI é recusado')

// Rejeitar liberta a vaga: volta a poder inscrever-se no mesmo curso...
await como(staff, `update public.inscricoes set estado = 'rejeitado' where numero_bi = '3301' and curso_id = '${cA}'`)
await como(staff, novaInsc('3301', cA, 'pendente'))
await esperaErro(staff, novaInsc('3301', cD, 'pendente'), /Limite de inscrições atingido/,
  '023: rejeitada liberta a vaga e o limite mantém-se em 3')

// Caminho de actualização: a secretaria muda o BI de uma inscrição para um BI já cheio
await esperaErro(staff,
  `update public.inscricoes set numero_bi = '3301' where numero_inscricao = 'INS-2026-000004'`,
  /Limite de inscrições atingido/,
  '023: mudar um BI para outro já com 3 activas é recusado')

// A RPC pública (anon) recusa com as mesmas mensagens, vinda do servidor
await esperaErro(null,
  `select * from public.submeter_inscricao_publica('Aluno Limite', '3301', '2004-08-08', 'M', null, '840000301', '${cD}', 'manha'::public.turno)`,
  /Limite de inscrições atingido/,
  '023: a RPC pública recusa a 4ª inscrição com a mensagem do limite')
await esperaErro(null,
  `select * from public.submeter_inscricao_publica('Aluno Dup', '3302', '2004-09-09', 'F', null, '840000302', '${cA}', 'manha'::public.turno)`,
  /Já existe uma inscrição activa/,
  '023: a RPC pública recusa o mesmo curso duas vezes')

// Um BI novo continua a submeter normalmente — a regra antiga de "BI único" acabou
const rNovo = await como(null, `
  select * from public.submeter_inscricao_publica('Aluno Novo 023', '3303', '2004-10-10', 'F', null, '840000303', '${cD}', 'manha'::public.turno)
`)
verificar('023: um BI novo submete normalmente pela RPC pública',
  !!rNovo[0]?.numero_inscricao && /^INS-2026-/.test(rNovo[0].numero_inscricao ?? ''),
  JSON.stringify(rNovo[0]))

// A função do trigger não é chamável pela API e tem search_path fixo (higiene das 014/015/021)
verificar('023: função do trigger não é chamável pela API',
  (await db.query(`select has_function_privilege('authenticated', 'public.validar_limite_inscricoes()', 'EXECUTE') as ok`)).rows[0].ok === false)
verificar('023: função do trigger tem search_path fixo',
  /search_path/.test((await db.query(`
    select coalesce(array_to_string(proconfig, ','), '') as o
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'validar_limite_inscricoes'
  `)).rows[0]?.o ?? ''))

// ===========================================================================
grupo('024 — inscrição sem BI e sem data de nascimento; identidade nome+celular')

// A RPC aceita sem BI e sem data de nascimento (os campos saíram do formulário).
const r024 = await como(null, `
  select * from public.submeter_inscricao_publica('Aluno Sem Documentos', null, null, null, null, '841111001', '${cB}', 'tarde'::public.turno)
`)
verificar('024: submete sem BI e sem data de nascimento', !!r024[0]?.numero_inscricao, JSON.stringify(r024[0]))
const linha024 = (await como(staff,
  `select numero_bi, data_nascimento from public.inscricoes where id = '${r024[0]?.inscricao_id}'`))[0]
verificar('024: BI e data de nascimento ficam vazios na BD',
  linha024?.numero_bi === null && linha024?.data_nascimento === null, JSON.stringify(linha024))

/** RPC pública sem BI e sem data de nascimento — identidade só nome+celular. */
const semBi = (nome, tel, curso, bi = null) => `
  select * from public.submeter_inscricao_publica('${nome}', ${bi ? `'${bi}'` : 'null'}, null, null, null, '${tel}', '${curso}', 'manha'::public.turno)
`

// Sem BI, o limite de 3 é contado por nome+celular.
await como(null, semBi('Aluno Celular', '845555005', cA))
await como(null, semBi('Aluno Celular', '845555005', cC))
await como(null, semBi('Aluno Celular', '845555005', cD))
verificar('024: 3 cursos sem BI passam pelo nome+celular',
  (await db.query(`select count(*)::int as n from public.inscricoes where nome_completo = 'Aluno Celular'`)).rows[0].n === 3)

await esperaErro(null, semBi('Aluno Celular', '845555005', cB),
  /Limite de inscrições atingido/, '024: a 4ª inscrição sem BI é recusada por nome+celular')

// Informar o BI depois não zera o contador: a identidade continua a casar
// pelo nome+celular (não dá para contornar o limite só por omitir o BI).
await esperaErro(null, semBi('Aluno Celular', '845555005', cB, '3399'),
  /Limite de inscrições atingido/,
  '024: submeter com BI depois (mesmo nome+celular) continua no mesmo contador')

// Duplicado do mesmo curso também casa por nome+celular.
await como(null, semBi('Aluno Duplicado', '846666006', cA))
await esperaErro(null, semBi('Aluno Duplicado', '846666006', cA),
  /Já existe uma inscrição activa/, '024: repetir o mesmo curso sem BI é recusado por nome+celular')

// Higiene da função do trigger (substituída pela 024), como nas 021/023.
verificar('024: função do trigger não é chamável pela API',
  (await db.query(`select has_function_privilege('authenticated', 'public.validar_limite_inscricoes()', 'EXECUTE') as ok`)).rows[0].ok === false)
verificar('024: função do trigger tem search_path fixo',
  /search_path/.test((await db.query(`
    select coalesce(array_to_string(proconfig, ','), '') as o
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'validar_limite_inscricoes'
  `)).rows[0]?.o ?? ''))

// ===========================================================================
grupo('025 — apagar utilizador (só admin; nunca a si próprio; desliga formadores)')

const uAlvoA = '08000000-0000-0000-0000-000000000008'
const uForm025 = '07000000-0000-0000-0000-000000000007'
const fNovo025 = 'f7000000-0000-0000-0000-000000000007'
await db.exec(`
  insert into auth.users (id, email, raw_app_meta_data, created_at, updated_at) values
    ('${uAlvoA}', 'apagar-a@exemplo.mz', '{"papel":"secretaria"}'::jsonb, now(), now()),
    ('${uForm025}', 'formador-apagar@exemplo.mz', '{"papel":"formador"}'::jsonb, now(), now());
  insert into public.formadores (id, nome, user_id) values
    ('${fNovo025}', 'Formador Apagar', '${uForm025}');
`)

await recusa(null, `select * from public.apagar_utilizador('${uAlvoA}')`, [],
  /Apenas o administrador/, '025: anónimo não apaga contas')
await recusa(staff, `select * from public.apagar_utilizador('${uAlvoA}')`, [],
  /Apenas o administrador/, '025: secretaria não apaga contas')

const apagou025 = (await como(admin, `select * from public.apagar_utilizador('${uAlvoA}')`))[0]
verificar('025: admin apaga a conta',
  apagou025?.sucesso === true && /eliminada/.test(apagou025?.mensagem ?? ''), JSON.stringify(apagou025))
verificar('025: a linha de auth.users desapareceu',
  (await db.query(`select count(*)::int as n from auth.users where id = '${uAlvoA}'`)).rows[0].n === 0)

await recusa(admin, `select * from public.apagar_utilizador('${uAlvoA}')`, [],
  /não encontrada/, '025: apagar conta inexistente dá mensagem clara')
await recusa(admin, `select * from public.apagar_utilizador('${uAdmin}')`, [],
  /própria conta/, '025: ninguém apaga a própria conta')

const rForm025 = (await como(admin, `select * from public.apagar_utilizador('${uForm025}')`))[0]
verificar('025: admin apaga a conta de um formador', rForm025?.sucesso === true, JSON.stringify(rForm025))
const dep025 = (await db.query(`
  select (select count(*)::int from public.formadores where id = '${fNovo025}') as registo,
         (select user_id from public.formadores where id = '${fNovo025}') as uid
`)).rows[0]
verificar('025: o registo do formador fica e o user_id é limpo',
  dep025.registo === 1 && dep025.uid === null, JSON.stringify(dep025))

verificar('025: RPC executável por authenticated',
  (await db.query(`select has_function_privilege('authenticated', 'public.apagar_utilizador(uuid)', 'EXECUTE') as ok`)).rows[0].ok === true)
verificar('025: RPC não executável por anon',
  (await db.query(`select has_function_privilege('anon', 'public.apagar_utilizador(uuid)', 'EXECUTE') as ok`)).rows[0].ok === false)
verificar('025: RPC tem search_path fixo',
  /search_path/.test((await db.query(`
    select coalesce(array_to_string(proconfig, ','), '') as o
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'apagar_utilizador'
  `)).rows[0]?.o ?? ''))

// ===========================================================================
grupo('026 — cobranças: catálogo, aplicação a alunos e estado')

// Grants: o catálogo é staff-only (o RLS não corre no PGlite, os grants sim).
verificar('026: authenticated escreve no catálogo',
  (await db.query(`select has_table_privilege('authenticated', 'public.cobrancas', 'INSERT') as ok`)).rows[0].ok === true)
verificar('026: anon não escreve no catálogo',
  (await db.query(`select has_table_privilege('anon', 'public.cobrancas', 'INSERT') as ok`)).rows[0].ok === false)
verificar('026: anon não escreve nas dívidas',
  (await db.query(`select has_table_privilege('anon', 'public.cobrancas_alunos', 'INSERT') as ok`)).rows[0].ok === false)

const cbTestes = 'cb000000-0000-0000-0000-000000000001'
const cbExame = 'cb000000-0000-0000-0000-000000000002'
await como(staff, `
  insert into public.cobrancas (id, nome, descricao, valor) values
    ('${cbTestes}', 'Testes (3 testes)', 'Três testes no período', 450),
    ('${cbExame}', 'Exame', 'Exame final', 800)
`)

const rAnon026 = (await como(null, `select * from public.aplicar_cobranca('${cbTestes}', null, true)`))[0]
verificar('026: anónimo não aplica cobranças',
  rAnon026?.aplicados === 0 && /Apenas a secretaria/.test(rAnon026?.mensagem ?? ''), JSON.stringify(rAnon026))

// Aplicar a todos os activos (contagem dinâmica: outros grupos matriculam alunos)
const activos026 = (await db.query(
  `select count(*)::int as n from public.alunos_matriculados where estado_aluno = 'ativo'`)).rows[0].n
const rTodos026 = (await como(staff, `select * from public.aplicar_cobranca('${cbTestes}', null, true)`))[0]
verificar('026: aplicar a todos os activos cria uma dívida por aluno',
  rTodos026?.aplicados === activos026, `${rTodos026?.aplicados} de ${activos026}`)
const div026 = (await db.query(`
  select count(*)::int as n, coalesce(sum(valor), 0) as soma
    from public.cobrancas_alunos
   where cobranca_id = '${cbTestes}' and estado = 'pendente'
`)).rows[0]
verificar('026: dívidas nascem pendentes com o valor do catálogo',
  div026.n === activos026 && Number(div026.soma) === 450 * activos026, JSON.stringify(div026))

const rRepet026 = (await como(staff, `select * from public.aplicar_cobranca('${cbTestes}', null, true)`))[0]
verificar('026: re-aplicar não duplica dívidas', rRepet026?.aplicados === 0, JSON.stringify(rRepet026))

const rEscolha026 = (await como(staff,
  `select * from public.aplicar_cobranca('${cbExame}', array['${a1}','${a2}']::uuid[], false)`))[0]
verificar('026: aplicar a alunos escolhidos cria 2 dívidas', rEscolha026?.aplicados === 2, JSON.stringify(rEscolha026))

const rSemEscolha = (await como(staff, `select * from public.aplicar_cobranca('${cbExame}', null, false)`))[0]
verificar('026: sem alunos escolhidos a RPC explica o que falta',
  rSemEscolha?.aplicados === 0 && /Escolha os alunos/.test(rSemEscolha?.mensagem ?? ''), JSON.stringify(rSemEscolha))

await como(staff, `update public.cobrancas set ativo = false where id = '${cbExame}'`)
const rDesac026 = (await como(staff, `select * from public.aplicar_cobranca('${cbExame}', array['${a3}']::uuid[], false)`))[0]
verificar('026: cobrança desactivada não é aplicável',
  rDesac026?.aplicados === 0 && /desactivada/.test(rDesac026?.mensagem ?? ''), JSON.stringify(rDesac026))

// Valor copiado na aplicação: mudar o catálogo não reescreve dívidas lançadas.
await como(staff, `update public.cobrancas set valor = 999 where id = '${cbTestes}'`)
const somaDepois = (await db.query(
  `select coalesce(sum(valor), 0) as soma from public.cobrancas_alunos where cobranca_id = '${cbTestes}'`)).rows[0].soma
verificar('026: mudar o preço do catálogo não altera dívidas lançadas',
  Number(somaDepois) === 450 * activos026, String(somaDepois))

// Com histórico não se apaga o tipo (FK restrict — a UI pré-verifica também).
await esperaErro(staff, `delete from public.cobrancas where id = '${cbTestes}'`,
  /foreign key constraint/i, '026: apagar tipo com dívidas registadas é bloqueado')

// Estado: marcar pago por escrita directa do staff, como em pagamentos.
const umaDiv026 = (await db.query(
  `select id from public.cobrancas_alunos where cobranca_id = '${cbExame}' order by created_at limit 1`)).rows[0]
await como(staff,
  `update public.cobrancas_alunos set estado = 'pago', data_pagamento = current_date, metodo = 'numerario' where id = '${umaDiv026.id}'`)
const paga026 = (await db.query(
  `select estado, data_pagamento from public.cobrancas_alunos where id = '${umaDiv026.id}'`)).rows[0]
verificar('026: marcar pago grava estado e data',
  paga026.estado === 'pago' && paga026.data_pagamento !== null, JSON.stringify(paga026))

verificar('026: RPC não executável por anon',
  (await db.query(`select has_function_privilege('anon', 'public.aplicar_cobranca(uuid, uuid[], boolean)', 'EXECUTE') as ok`)).rows[0].ok === false)
verificar('026: RPC executável por authenticated',
  (await db.query(`select has_function_privilege('authenticated', 'public.aplicar_cobranca(uuid, uuid[], boolean)', 'EXECUTE') as ok`)).rows[0].ok === true)
verificar('026: RPC tem search_path fixo',
  /search_path/.test((await db.query(`
    select coalesce(array_to_string(proconfig, ','), '') as o
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'aplicar_cobranca'
  `)).rows[0]?.o ?? ''))

// ===========================================================================
console.log(falhas === 0 ? `\n${total} verificações passaram.` : `\n${falhas} de ${total} verificações FALHARAM.`)
await db.close()
process.exit(falhas === 0 ? 0 : 1)
