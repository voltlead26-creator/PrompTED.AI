-- PrompTED: curated Australian job-market database (baseline)
-- Powers the job-match edge function. Service-role access only
-- (RLS enabled with no public policies). Refresh rows any time -
-- the function reads this table live, falling back to its bundled
-- dataset when the table is missing or empty.

create table if not exists public.job_market_roles (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  industry text not null,
  demand text not null check (demand in ('very high','high','moderate')),
  typical_pay_aud text not null,
  entry_requirements text not null default '',
  fast_start boolean not null default false,
  start_speed text not null default '',
  where_to_apply text[] not null default '{}',
  notes text not null default '',
  data_as_of text not null default 'June 2026',
  updated_at timestamptz not null default now()
);

alter table public.job_market_roles enable row level security;

truncate table public.job_market_roles;

insert into public.job_market_roles
  (role, industry, demand, typical_pay_aud, entry_requirements, fast_start, start_speed, where_to_apply, notes)
values
  ('Kitchen hand', 'Hospitality', 'high', 'approx $31/hr casual; more on weekends', 'None', true, 'Often within days - walk-ins and same-week trials are common', array['SEEK','Indeed','Sidekicker','walk in with a one-page resume'], 'The fastest no-experience start almost anywhere in Australia. High churn means constant vacancies.'),
  ('Bar / wait staff', 'Hospitality', 'high', 'approx $31-33/hr casual base; $40-70/hr with weekend and public-holiday penalties', 'State RSA certificate (online course, often same day)', true, '2-7 days once RSA is done', array['SEEK','Indeed','Frontline Hospitality','venue walk-ins'], 'Weekend penalty rates make this one of the best-paying fast-start options. RSA rules vary by state.'),
  ('Warehouse storeperson / pick packer', 'Warehousing & logistics', 'high', 'approx $32-38/hr casual via labour hire; $38-42/hr with a forklift licence', 'None for entry; LF forklift licence (2-day course) lifts pay', true, '2-5 days via labour hire agencies', array['Programmed','Adecco','Randstad','Workfast','SEEK'], 'Logistics hubs on city fringes place people within days.'),
  ('Construction labourer', 'Construction & civil', 'very high', 'approx $35-45/hr casual via labour hire; EBA sites higher', 'White Card (1-day course, approx $100)', true, 'Within a week of getting a White Card', array['Programmed','Chandler Macleod','Workfast','SEEK'], 'Infrastructure pipelines keep demand very strong nationwide. Best pay among fast-start options.'),
  ('Traffic controller', 'Construction & civil', 'very high', 'approx $35-45/hr; night/weekend shifts considerably more', 'State traffic management ticket (approx 2-day course) + White Card', false, '1-2 weeks including the course', array['traffic management agencies','SEEK'], 'Two days of training converts to one of the best-paid entry roles going.'),
  ('Commercial cleaner', 'Services', 'high', 'approx $30-35/hr casual', 'Usually a police check', true, 'Within a week', array['SEEK','Indeed','cleaning contractors directly'], 'Early-morning and evening shifts suit combining with other work or study.'),
  ('Retail assistant', 'Retail', 'moderate', 'approx $32-33/hr casual; penalties on weekends', 'None', true, '1-2 weeks; faster in peak seasons', array['SEEK','Indeed','retailer career pages'], 'Hiring spikes before Christmas, EOFY and back-to-school.'),
  ('Events / promo staff', 'Events & hospitality', 'high', 'approx $31-45/hr casual depending on role and penalties', 'RSA for bar roles', true, 'Days - platform-based shifts (e.g. Sidekicker)', array['Sidekicker','event staffing agencies'], 'Major-city events calendars create constant short bursts of well-paid work.'),
  ('Delivery / rideshare driver', 'Gig economy', 'moderate', 'approx $25-35/hr gross BEFORE vehicle costs', 'Full licence + own car/bike; background check', true, 'Days (onboarding + checks)', array['Uber/DoorDash/Menulog/Amazon Flex apps'], 'Genuine same-week income but factor in fuel, wear and tax - net is lower than award casual roles.'),
  ('Call centre / customer service', 'Business services', 'moderate', 'approx $32-36/hr', 'None formal; clear phone manner', true, '1-3 weeks - hired in intake waves', array['Hays','Adecco','SEEK'], 'Government and utilities contracts regularly hire big intakes; remote roles widen the net.'),
  ('Disability support worker (NDIS)', 'Healthcare & social assistance', 'very high', 'approx $41-46/hr casual (SCHADS award)', 'NDIS Worker Screening Check + Working with Children Check; no formal qualification required to start', false, '1-3 weeks while checks clear', array['Hireup','Mable','provider websites','SEEK'], 'One of the highest-paying roles available without a qualification - life/care experience counts. Massive ongoing national shortage.'),
  ('Aged care personal care assistant', 'Healthcare & social assistance', 'very high', 'approx $33-40/hr casual', 'Police check; Cert III preferred but entry roles exist with paid training', false, '2-4 weeks', array['provider websites','SEEK','Workforce Australia'], 'Government-funded wage rises have lifted pay markedly; providers hire continuously, especially regionally.'),
  ('Security officer', 'Services', 'high', 'approx $35-40/hr with penalties', 'State security licence (course + licence processing)', false, '4-8 weeks if unlicensed; days if already licensed', array['security firms','SEEK'], 'Only a fast option if you already hold a licence.'),
  ('Duty manager / venue supervisor', 'Hospitality management', 'high', 'approx $75-95k salary or $40-50/hr casual', 'Hospitality supervision experience; RSA (some states require advanced/licensee RSA for late venues)', true, '1-3 weeks for experienced managers', array['Frontline Hospitality','Placed Recruitment','SEEK','LinkedIn'], 'Experienced managers are scarce; venues frequently poach. Strong fit for ex-business owners.'),
  ('Venue manager / operations manager (hospitality)', 'Hospitality management', 'high', 'approx $90-130k+ in capital cities depending on venue size', 'Proven venue/ops management track record; P&L ownership valued', false, '2-6 weeks (interview processes)', array['Frontline Hospitality','LinkedIn','SEEK','direct approaches to groups'], 'Business-ownership experience is a major differentiator for multi-site and group roles.'),
  ('Early childhood educator', 'Education', 'very high', 'approx $33-38/hr; rising under funded wage increases', 'Working with Children Check; Cert III (can often start as trainee while studying)', false, '2-4 weeks', array['centre websites','SEEK'], 'National shortage; traineeships let you earn while you qualify.'),
  ('Accounts officer / bookkeeper (temp)', 'Business services', 'high', 'approx $35-45/hr temp', 'Bookkeeping/admin experience; Xero/MYOB valued', true, '1-2 weeks via temp desks', array['Hays','Robert Half','SEEK'], 'Accounting skills remain on the national shortage list; temp desks move fast.'),
  ('Admin / office support (temp)', 'Business services', 'moderate', 'approx $33-40/hr temp', 'Office experience; references', true, 'Days to 2 weeks via temp agencies', array['Hays','Adecco','Randstad'], 'Temp-to-perm is a common path back into stable work after redundancy.');
