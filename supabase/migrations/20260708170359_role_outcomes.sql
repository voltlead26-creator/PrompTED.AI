create table if not exists public.role_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  saved_role_id uuid not null references public.saved_roles(id) on delete cascade,
  stage text not null check (stage in (
    'applied','phone_screen','interview_1','interview_2','interview_3',
    'final_round','offer','hired','rejected','no_response','withdrawn'
  )),
  note text,
  occurred_at date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.role_outcomes enable row level security;

create policy "role_outcomes_own" on public.role_outcomes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists role_outcomes_role_idx on public.role_outcomes (saved_role_id, occurred_at desc);

-- Denormalised latest-stage column on saved_roles so lists (e.g. the
-- Sections/Role matches rail) can show current status without a join.
alter table public.saved_roles
  add column if not exists latest_stage text;

create or replace function public.sync_saved_role_latest_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.saved_roles
  set latest_stage = new.stage,
      updated_at = now()
  where id = new.saved_role_id;
  return new;
end;
$$;

drop trigger if exists role_outcomes_sync_latest_stage on public.role_outcomes;
create trigger role_outcomes_sync_latest_stage
  after insert on public.role_outcomes
  for each row execute function public.sync_saved_role_latest_stage();;
