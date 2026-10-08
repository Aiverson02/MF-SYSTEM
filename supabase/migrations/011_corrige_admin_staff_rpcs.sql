-- 011 — Corrige os gates admin das RPCs de utilizadores staff.
-- Em JWTs reais do GoTrue os metadados viajam como 'user_metadata'/'app_metadata';
-- 'raw_user_meta_data' só existe como coluna de auth.users, nunca no token.
-- Corrige também 'redefinir_password_staff', que ficou com corpo vazio no servidor.

create or replace function public.criar_utilizador_staff(p_email text, p_password text, p_papel text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := gen_random_uuid();
begin
  if coalesce(
       nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'user_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'raw_user_meta_data' ->> 'papel', ''),
       '') <> 'admin' then
    return query select false, 'Apenas o admin pode criar utilizadores.'::text;
    return;
  end if;
  if p_papel not in ('secretaria', 'admin') then
    return query select false, 'Papel inválido (secretaria ou admin).'::text;
    return;
  end if;
  if length(coalesce(p_password, '')) < 6 then
    return query select false, 'A password deve ter pelo menos 6 caracteres.'::text;
    return;
  end if;

  select u.id into v_uid from auth.users u where lower(u.email) = lower(p_email);
  if found then
    return query select false, 'Já existe um utilizador com este email.'::text;
    return;
  end if;

  v_uid := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    lower(p_email), crypt(p_password, gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('papel', p_papel),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    provider_id, provider, user_id, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    v_uid::text, 'email', v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', lower(p_email), 'email_verified', false),
    now(), now(), now()
  );

  return query select true, format('Utilizador %s criado com papel %s.', lower(p_email), p_papel)::text;
end;
$$;

create or replace function public.redefinir_password_staff(p_user_id uuid, p_nova_password text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(
       nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'user_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'raw_user_meta_data' ->> 'papel', ''),
       '') <> 'admin' then
    return query select false, 'Apenas o admin pode redefinir passwords.'::text;
    return;
  end if;
  if length(coalesce(p_nova_password, '')) < 6 then
    return query select false, 'A password deve ter pelo menos 6 caracteres.'::text;
    return;
  end if;

  update auth.users
     set encrypted_password = crypt(p_nova_password, gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;

  if not found then
    return query select false, 'Utilizador não encontrado.'::text;
    return;
  end if;

  return query select true, 'Password redefinida com sucesso.'::text;
end;
$$;

create or replace function public.alterar_papel_staff(p_user_id uuid, p_papel text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(
       nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'user_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'raw_user_meta_data' ->> 'papel', ''),
       '') <> 'admin' then
    return query select false, 'Apenas o admin pode alterar papéis.'::text;
    return;
  end if;
  if p_papel not in ('secretaria', 'admin') then
    return query select false, 'Papel inválido.'::text;
    return;
  end if;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('papel', p_papel),
         updated_at = now()
   where id = p_user_id;

  if not found then
    return query select false, 'Utilizador não encontrado.'::text;
    return;
  end if;

  return query select true, format('Papel alterado para %s.', p_papel)::text;
end;
$$;

revoke all on function public.criar_utilizador_staff(text, text, text) from public, anon;
grant execute on function public.criar_utilizador_staff(text, text, text) to authenticated;
revoke all on function public.redefinir_password_staff(uuid, text) from public, anon;
grant execute on function public.redefinir_password_staff(uuid, text) to authenticated;
revoke all on function public.alterar_papel_staff(uuid, text) from public, anon;
grant execute on function public.alterar_papel_staff(uuid, text) to authenticated;
