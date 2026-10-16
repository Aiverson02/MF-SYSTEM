-- ============================================================================
-- 017 — HIGIENE: search_path fixo em nota_minima_aprovacao()
-- ============================================================================
-- O advisor de segurança do Supabase (lint 0011 function_search_path_mutable)
-- sinalizava esta função porque ficou criada na 015 sem search_path fixo — a
-- mesma correcção que a 014 aplicou a set_updated_at(). A função é imutável e
-- não referencia nenhum schema, mas fixar o search_path elimina o aviso e
-- impede que objetos homónimos noutras schemas sejam resolvidos por engano.
-- ============================================================================

alter function public.nota_minima_aprovacao() set search_path = public;

comment on function public.nota_minima_aprovacao() is
  'Nota mínima de aprovação na escala 0–20. Alterar aqui muda a vista e a UI. (search_path fixo — 017)';
