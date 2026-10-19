-- ============================================================================
-- 022 — Catálogo de cursos: novas formações do centro
-- ----------------------------------------------------------------------------
-- Insere os 14 cursos pedidos. Idempotente: `on conflict (codigo) do nothing`
-- garante que re-executar não duplica nem altera cursos já existentes
-- (ex.: Informatica Basica, Marketing e Vendas e Relações Públicas).
-- ============================================================================

insert into public.cursos (nome, codigo, ativo) values
  ('Atendimento ao Cliente e Caixa',        'ATC-CC',   true),
  ('Beleza e Estética',                    'BEL-EST',  true),
  ('Contabilidade Geral',                  'CON-G',    true),
  ('Culinária (Doces, Salgados e Bolos)',  'CUL-DSB',  true),
  ('Educação de Infância',                 'EDU-INF',  true),
  ('Eletrecidade Instaladora',             'ELET-INS', true),
  ('Gestão de Recursos Humanos',           'GRH',      true),
  ('Mestre de Cerimónias',                 'MEST-CER', true),
  ('Inglês',                               'ING',      true),
  ('Jornalismo',                           'JORNAL',   true),
  ('Secretariado Executivo',               'SEC-EX',   true),
  ('Noções de Relações Públicas',          'NOC-RP',   true),
  ('Design Gráfico e Edição de Vídeos',    'DES-VE',   true),
  ('Importação e Exportação',              'IMP-EXP',  true)
on conflict (codigo) do nothing;
