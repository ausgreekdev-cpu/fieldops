-- FieldOps — Initial Schema (Postgres 15 + Supabase)
-- Run with: supabase db reset  |  supabase migration up
-- Tables: companies, users, jobs, job_photos, job_signatures, compliance_checklists, checklist_submissions, invoices, sync_logs
-- plus RLS, indexes, triggers, storage buckets

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- Enums
do $$ begin create type job_status as enum ('scheduled','in_progress','completed','invoiced'); exception when duplicate_object then null; end $$;
do $$ begin create type user_role as enum ('owner','admin','technician'); exception when duplicate_object then null; end $$;
do $$ begin create type invoice_status as enum ('draft','sent','paid','overdue','void'); exception when duplicate_object then null; end $$;
do $$ begin create type sync_operation as enum ('insert','update','delete','ai_voice','ai_receipt'); exception when duplicate_object then null; end $$;
do $$ begin create type sync_queue_status as enum ('pending','syncing','failed','synced'); exception when duplicate_object then null; end $$;
do $$ begin create type subscription_tier as enum ('free','pro','team'); exception when duplicate_object then null; end $$;

-- Helper: updated_at trigger
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

-- ============ COMPANIES ============
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  logo_url text,
  abn text check (abn ~ '^[0-9 ]{0,20}$'),
  tax_rate numeric(5,2) default 10.00 check (tax_rate >=0 and tax_rate <=100),
  country text default 'AU',
  address text,
  stripe_customer_id text unique,
  subscription_tier subscription_tier not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated before update on public.companies for each row execute function set_updated_at();
create index if not exists idx_companies_name_trgm on public.companies using gin (name gin_trgm_ops);

-- ============ USERS (profile extends auth.users) ============
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  role user_role not null default 'technician',
  display_name text,
  phone text unique check (phone ~ '^\+?[0-9 ]{7,20}$'),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated before update on public.users for each row execute function set_updated_at();
create index if not exists idx_users_company on public.users(company_id);
create index if not exists idx_users_phone on public.users(phone);

-- ============ JOBS ============
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  local_id text unique, -- client-generated uuid for offline dedup
  company_id uuid not null references public.companies(id) on delete cascade,
  assigned_to uuid references public.users(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  customer_email text,
  address text not null,
  lat double precision,
  lng double precision,
  title text not null,
  description text,
  status job_status not null default 'scheduled',
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  -- AI-extracted materials stored as jsonb for invoicing
  materials jsonb not null default '[]'::jsonb,
  notes text,
  -- sync bookkeeping
  version int not null default 1,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
drop trigger if exists trg_jobs_updated on public.jobs;
create trigger trg_jobs_updated before update on public.jobs for each row execute function set_updated_at();
create index if not exists idx_jobs_company_status on public.jobs(company_id, status);
create index if not exists idx_jobs_assigned on public.jobs(assigned_to);
create index if not exists idx_jobs_scheduled on public.jobs(scheduled_at);
create index if not exists idx_jobs_customer_trgm on public.jobs using gin (customer_name gin_trgm_ops);
create index if not exists idx_jobs_materials_gin on public.jobs using gin (materials);

-- ============ JOB PHOTOS ============
create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  storage_path text not null, -- storage bucket path: company_id/job_id/filename
  local_uri text, -- client local file uri before upload
  caption text,
  lat double precision,
  lng double precision,
  taken_at timestamptz not null default now(),
  taken_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_photos_job on public.job_photos(job_id);

-- ============ JOB SIGNATURES ============
create table if not exists public.job_signatures (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  storage_path text not null,
  signed_by_name text not null,
  signed_at timestamptz not null default now(),
  signature_data text, -- base64 or svg path if needed
  created_at timestamptz not null default now()
);
create index if not exists idx_signatures_job on public.job_signatures(job_id);

-- ============ COMPLIANCE CHECKLISTS (templates) ============
create table if not exists public.compliance_checklists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  -- fields: [{key, label, type: 'pass_fail'|'checkbox'|'text'|'photo', required, options}]
  fields jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_checklists_updated on public.compliance_checklists;
create trigger trg_checklists_updated before update on public.compliance_checklists for each row execute function set_updated_at();
create index if not exists idx_checklists_company on public.compliance_checklists(company_id);

-- ============ CHECKLIST SUBMISSIONS ============
create table if not exists public.checklist_submissions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  checklist_id uuid not null references public.compliance_checklists(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  responses jsonb not null default '{}'::jsonb, -- {field_key: value}
  photo_proofs text[] default '{}',
  signed_by uuid references public.users(id),
  signed_at timestamptz,
  result text check (result in ('pass','fail','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_submissions_updated on public.checklist_submissions;
create trigger trg_submissions_updated before update on public.checklist_submissions for each row execute function set_updated_at();
create index if not exists idx_submissions_job on public.checklist_submissions(job_id);

-- ============ INVOICES ============
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_number text not null, -- e.g., INV-2026-0001
  line_items jsonb not null default '[]'::jsonb, -- [{desc, qty, unit_price, amount}]
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  status invoice_status not null default 'draft',
  pdf_path text,
  payment_link text,
  stripe_invoice_id text,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_invoices_updated on public.invoices;
create trigger trg_invoices_updated before update on public.invoices for each row execute function set_updated_at();
create index if not exists idx_invoices_company on public.invoices(company_id);
create index if not exists idx_invoices_job on public.invoices(job_id);
create unique index if not exists uniq_invoice_number_company on public.invoices(company_id, invoice_number);

-- Auto-increment invoice number per company (simple function; call from app/edge)
create or replace function next_invoice_number(target_company uuid) returns text as $$
declare cnt int; yr text;
begin
  yr := to_char(now(),'YYYY');
  select count(*) +1 into cnt from public.invoices where company_id=target_company and invoice_number like 'INV-'||yr||'-%';
  return 'INV-'||yr||'-'|| lpad(cnt::text, 4, '0');
end; $$ language plpgsql security definer;

-- ============ SYNC LOGS (audit + queue visibility) ============
create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  company_id uuid references public.companies(id) on delete cascade,
  table_name text not null,
  record_id text not null,
  operation sync_operation not null,
  payload jsonb,
  status sync_queue_status not null default 'pending',
  error text,
  attempts int not null default 0,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sync_logs_company_status on public.sync_logs(company_id, status);
create index if not exists idx_sync_logs_user on public.sync_logs(user_id);
create index if not exists idx_sync_logs_next_retry on public.sync_logs(next_retry_at);

-- ============ HELPERS ============
create or replace function public.is_company_member(target_company uuid) returns boolean as $$
  select exists (select 1 from public.users where id = auth.uid() and company_id = target_company and deleted_at is null);
$$ language sql security definer stable;

create or replace function public.my_company_id() returns uuid as $$
  select company_id from public.users where id = auth.uid();
$$ language sql security definer stable;

-- Auto-create users row on signup (auth.users -> public.users)
create or replace function public.handle_new_auth_user() returns trigger as $$
begin
  insert into public.users (id, display_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''), new.phone)
  on conflict (id) do nothing;
  return new;
end; $$ language plpgsql security definer;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

-- ============ RLS ============
alter table public.companies enable row level security;
alter table public.users enable row level security;
alter table public.jobs enable row level security;
alter table public.job_photos enable row level security;
alter table public.job_signatures enable row level security;
alter table public.compliance_checklists enable row level security;
alter table public.checklist_submissions enable row level security;
alter table public.invoices enable row level security;
alter table public.sync_logs enable row level security;

-- Companies: members can read their own company; owners/admins can update; insert via service_role or authenticated
drop policy if exists "companies_select_member" on public.companies;
create policy "companies_select_member" on public.companies for select using (public.is_company_member(id) or id = public.my_company_id());
drop policy if exists "companies_insert_auth" on public.companies;
create policy "companies_insert_auth" on public.companies for insert with check (auth.role() = 'authenticated');
drop policy if exists "companies_update_member" on public.companies;
create policy "companies_update_member" on public.companies for update using (public.is_company_member(id)) with check (public.is_company_member(id));
drop policy if exists "companies_delete_none" on public.companies;
create policy "companies_delete_none" on public.companies for delete using (false);

-- Users: can read members of same company, can update own row
drop policy if exists "users_select_same_company" on public.users;
create policy "users_select_same_company" on public.users for select using (
  id = auth.uid() or company_id = public.my_company_id()
);
drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "users_insert_self" on public.users;
create policy "users_insert_self" on public.users for insert with check (id = auth.uid());

-- Jobs: full CRUD scoped to company
drop policy if exists "jobs_company_crud" on public.jobs;
create policy "jobs_company_crud" on public.jobs for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());

-- Job photos / signatures / checklists / submissions / invoices / sync_logs — same pattern
drop policy if exists "photos_company" on public.job_photos;
create policy "photos_company" on public.job_photos for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());
drop policy if exists "signatures_company" on public.job_signatures;
create policy "signatures_company" on public.job_signatures for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());
drop policy if exists "checklists_company" on public.compliance_checklists;
create policy "checklists_company" on public.compliance_checklists for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());
drop policy if exists "submissions_company" on public.checklist_submissions;
create policy "submissions_company" on public.checklist_submissions for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());
drop policy if exists "invoices_company" on public.invoices;
create policy "invoices_company" on public.invoices for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());
drop policy if exists "sync_logs_company" on public.sync_logs;
create policy "sync_logs_company" on public.sync_logs for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());

-- ============ STORAGE BUCKETS + POLICIES ============
insert into storage.buckets (id, name, public) values ('company-logos','company-logos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('job-photos','job-photos', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('signatures','signatures', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('invoices','invoices', false) on conflict (id) do nothing;

-- Storage RLS — scoped by company prefix in path:  <company_id>/...
-- Example path: 550e8400-.../jobId/photo.jpg  — first folder must equal my_company_id()
drop policy if exists "storage_job_photos_company" on storage.objects;
create policy "storage_job_photos_company" on storage.objects for all
  using (bucket_id in ('job-photos','signatures','invoices','company-logos') and (storage.foldername(name))[1] = public.my_company_id()::text)
  with check (bucket_id in ('job-photos','signatures','invoices','company-logos') and (storage.foldername(name))[1] = public.my_company_id()::text);

-- ============ SEED (optional dev) ============
-- Insert demo company + checklist template (run manually in local)
-- insert into public.companies (name, abn) values ('Demo Electrical','12 345 678 901');
