alter table public.documents
  add column if not exists unresolved_placeholders jsonb not null default '[]'::jsonb;

comment on column public.documents.unresolved_placeholders is
  'Enhanced DIP unresolved placeholder metadata persisted with the document outcome.';
