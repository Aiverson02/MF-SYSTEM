-- 012 — redefinir_password_staff precisa do schema extensions (pgcrypto: crypt/gen_salt)
-- no search_path; caso contrário falha com "function gen_salt(unknown) does not exist".

create or replace function public.redefinir_password_staff(p_user_id uuid, p_nova_password text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public, extensions
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
     set encrypted_password = extensions.crypt(p_nova_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;

  if not found then
    return query select false, 'Utilizador não encontrado.'::text;
    return;
  end if;

  return query select true, 'Password redefinida com sucesso.'::text;
end;
$$;

revoke all on function public.redefinir_password_staff(uuid, text) from public, anon;
grant execute on function public.redefinir_password_staff(uuid, text) to authenticated;
