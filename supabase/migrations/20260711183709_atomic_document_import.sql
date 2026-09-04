-- Atomic, idempotent Master Workspace import persistence.

alter table public.uploads
  add column if not exists status text not null default 'processing',
  add column if not exists document_id uuid references public.documents(id) on delete set null,
  add column if not exists idempotency_key text,
  add column if not exists completed_at timestamptz,
  add column if not exists error_code text;

alter table public.uploads drop constraint if exists uploads_status_check;
alter table public.uploads add constraint uploads_status_check
  check (status in ('processing', 'ready', 'committed', 'failed'));

create unique index if not exists idx_uploads_user_idempotency
  on public.uploads(user_id, idempotency_key)
  where idempotency_key is not null;

insert into storage.buckets (id, name, public, file_size_limit)
values ('original-documents', 'original-documents', false, 8388608)
on conflict (id) do update set public = false, file_size_limit = 8388608;

create policy "original_documents_read_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'original-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.commit_document_import(
  p_upload_id uuid,
  p_outcome_id uuid,
  p_document_id uuid,
  p_title text,
  p_situation_text text,
  p_recommendation_payload jsonb,
  p_sections jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_upload public.uploads%rowtype;
  v_section jsonb;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_upload
  from public.uploads
  where id = p_upload_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'UPLOAD_NOT_FOUND';
  end if;

  if v_upload.status = 'committed' then
    return jsonb_build_object(
      'status', 'committed',
      'outcome_id', v_upload.outcome_id,
      'document_id', v_upload.document_id,
      'idempotent_replay', true
    );
  end if;

  insert into public.outcomes (
    id, user_id, situation_text, recommendation_payload, status
  ) values (
    p_outcome_id, v_user_id, p_situation_text, p_recommendation_payload, 'in_progress'
  )
  on conflict (id) do update set
    situation_text = excluded.situation_text,
    recommendation_payload = excluded.recommendation_payload,
    status = excluded.status,
    updated_at = now()
  where public.outcomes.user_id = v_user_id;

  insert into public.documents (
    id, user_id, outcome_id, title, status
  ) values (
    p_document_id, v_user_id, p_outcome_id, p_title, 'draft'
  )
  on conflict (id) do update set
    outcome_id = excluded.outcome_id,
    title = excluded.title,
    status = excluded.status,
    updated_at = now()
  where public.documents.user_id = v_user_id;

  delete from public.sections
  where document_id = p_document_id and user_id = v_user_id;

  for v_section in select * from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb))
  loop
    insert into public.sections (
      id, document_id, user_id, name, order_index, content, status,
      version_history, is_required, created_at, updated_at
    ) values (
      (v_section->>'id')::uuid,
      p_document_id,
      v_user_id,
      coalesce(v_section->>'name', 'Untitled section'),
      coalesce((v_section->>'order_index')::integer, 0),
      coalesce(v_section->>'content', ''),
      coalesce(v_section->>'status', 'draft'),
      coalesce(v_section->'version_history', '[]'::jsonb),
      coalesce((v_section->>'is_required')::boolean, true),
      coalesce((v_section->>'created_at')::timestamptz, now()),
      now()
    );
  end loop;

  update public.uploads set
    outcome_id = p_outcome_id,
    document_id = p_document_id,
    status = 'committed',
    completed_at = now(),
    error_code = null
  where id = p_upload_id and user_id = v_user_id;

  return jsonb_build_object(
    'status', 'committed',
    'outcome_id', p_outcome_id,
    'document_id', p_document_id,
    'idempotent_replay', false
  );
exception when others then
  -- The transaction rolls back all writes automatically, including this function.
  raise;
end;
$$;

grant execute on function public.commit_document_import(uuid, uuid, uuid, text, text, jsonb, jsonb) to authenticated;
;
