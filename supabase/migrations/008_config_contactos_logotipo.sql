-- 008 — Contactos + logotipo da instituição (espelho da migration aplicada)

alter table public.config_instituicao
  add column if not exists telefone text,
  add column if not exists email text,
  add column if not exists endereco text,
  add column if not exists logo_url text;

-- Bucket público para o logotipo
insert into storage.buckets (id, name, public)
values ('logotipos', 'logotipos', true)
on conflict (id) do nothing;

create policy "logos_leitura_publica"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'logotipos');

create policy "logos_upload_staff"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'logotipos' and public.eh_staff());

create policy "logos_gestao_staff"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'logotipos' and public.eh_staff())
  with check (bucket_id = 'logotipos' and public.eh_staff());

create policy "logos_eliminar_staff"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'logotipos' and public.eh_staff());
