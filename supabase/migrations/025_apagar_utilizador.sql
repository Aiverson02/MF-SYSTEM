-- ============================================================================
-- 025 — Apagar utilizador do sistema (admin-only)
-- ============================================================================
-- Pedido da secretaria (2026-10-20): "permita também apagar um utilizador do
-- sistema".
--
-- A eliminação remove a conta de autenticação (auth.users — o que corta o
-- login) e desliga previamente qualquer registo de formador que aponte para
-- essa conta (`formadores.user_id` não tem FK: sem esta limpeza, ficaria um
-- apontador morto e o formador não voltaria a poder ligar-se). O registo do
-- formador em si NÃO é apagado — só a conta.
--
-- Salvaguardas (todas decididas no servidor, não na UI):
--   · só admin (`eh_admin()` dentro da função, à semelhança da 014);
--   · ninguém apaga a própria conta;
--   · nunca se elimina o último administrador (a instituição ficava sem dono);
--   · conta inexistente devolve erro claro em vez de falhar em silêncio.
--
-- Aplica-se a contas staff E a contas de formador (qualquer auth.users), porque
-- as referências internas conhecidas (pagamentos.criado_por,
-- pos_conclusao.pago_por, config_instituicao.updated_by) são todas
-- `on delete set null`.
-- ============================================================================

create or replace function public.apagar_utilizador(p_user_id uuid)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_papel  text;
  v_uid    uuid := auth.uid();
  v_admins integer;
begin
  -- Autorização decidida no servidor: a UI esconde o botão, aqui prova-se.
  if not public.eh_admin() then
    return query select false, 'Apenas o administrador pode eliminar utilizadores.'::text;
    return;
  end if;

  if p_user_id is null then
    return query select false, 'Conta não indicada.'::text;
    return;
  end if;

  if p_user_id = v_uid then
    return query select false, 'Não pode eliminar a própria conta.'::text;
    return;
  end if;

  select u.email,
         coalesce(nullif(u.raw_app_meta_data ->> 'papel', ''), 'secretaria')
    into v_email, v_papel
    from auth.users u
   where u.id = p_user_id;

  if v_email is null then
    return query select false, 'Conta não encontrada.'::text;
    return;
  end if;

  -- Último administrador: intocável (conta própria já está barrada acima,
  -- mas cobre o caso de dois admins onde um apaga o outro e sobra zero —
  -- aqui garantimos que fica sempre pelo menos um).
  if v_papel = 'admin' then
    select count(*)
      into v_admins
      from auth.users u
     where coalesce(nullif(u.raw_app_meta_data ->> 'papel', ''), 'secretaria') = 'admin'
       and u.id <> p_user_id;

    if v_admins = 0 then
      return query select false, 'Impossível eliminar o último administrador.'::text;
      return;
    end if;
  end if;

  -- Desligar a conta do registo de formador, se for o caso (o formador fica,
  -- sem conta — pode ligar outra depois em Utilizadores).
  update public.formadores
     set user_id = null
   where user_id = p_user_id;

  -- auth.identities desaparece em cascata; as restantes referências internas
  -- são `on delete set null`.
  delete from auth.users
   where id = p_user_id;

  return query select true, format('Conta %s eliminada.', v_email)::text;
end;
$$;

revoke all on function public.apagar_utilizador(uuid) from public, anon;
grant execute on function public.apagar_utilizador(uuid) to authenticated;
