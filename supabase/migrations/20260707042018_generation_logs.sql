create table if not exists public.generation_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  template_id text not null,
  bespoke boolean not null default false,
  section_count integer not null default 0,
  missing_sections integer not null default 0,
  missing_items integer not null default 0,
  duration_ms integer,
  status text not null check (status in ('ok','error')),
  error_message text
);

alter table public.generation_logs enable row level security;

-- Users may read their own generation history; only the service role writes.
create policy "generation_logs_select_own" on public.generation_logs
  for select using (auth.uid() = user_id);

create index if not exists generation_logs_created_at_idx on public.generation_logs (created_at desc);
create index if not exists generation_logs_template_idx on public.generation_logs (template_id, created_at desc);;
