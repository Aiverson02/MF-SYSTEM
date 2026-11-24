-- 037 — Catálogo público: duração de 3 meses e descrições em falta
--
-- Todos os cursos da instituição duram uma edição (3 meses). Dois cursos
-- antigos ainda tinham "2.5 meses" e não tinham descrição, o que aparecia
-- assim na landing page. Corrige-se o dado na origem, sem tocar no preçário.

update public.cursos
   set duracao   = '3 meses',
       descricao = 'Windows, Word, Excel e Internet: as ferramentas do dia-a-dia de um escritório.'
 where codigo = 'INF-BS';

update public.cursos
   set duracao   = '3 meses',
       descricao = 'Técnicas de venda e atendimento, campanhas de marketing e comunicação com o público.'
 where codigo = 'MK-VD';

-- Qualquer outro curso activo com duração fora do padrão fica alinhado.
update public.cursos
   set duracao = '3 meses'
 where ativo
   and duracao is distinct from '3 meses';
