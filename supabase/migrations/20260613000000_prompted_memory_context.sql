-- =====================================================
-- PrompTED memory context
-- Adds lightweight persisted memory for upload-derived facts.
-- =====================================================

alter table public.profiles
  add column if not exists memory_context jsonb not null default '[]'::jsonb;

alter table public.company_profile
  add column if not exists memory_context jsonb not null default '[]'::jsonb;
