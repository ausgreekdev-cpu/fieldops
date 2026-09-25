-- FieldOps — Sync integrity (invoice numbering + job version guard)
-- Run with: supabase db reset  |  supabase migration up

-- ============ 1. Race-safe invoice numbering ============
-- Was count(*)+1 (races under concurrency, collapses distinct local numbers).
-- Now: max()+1 under an advisory lock, membership-checked.
create or replace function public.next_invoice_number(target_company uuid) returns text as $$
declare cnt int; yr text;
begin
  if not public.is_company_member(target_company) then
    raise exception 'not allowed';
  end if;
  perform pg_advisory_xact_lock(hashtext('invoice:' || target_company::text));
  yr := to_char(now(),'YYYY');
  select coalesce(max(split_part(invoice_number, '-', 4)::int), 0) + 1 into cnt
    from public.invoices
   where company_id = target_company
     and invoice_number ~ ('^INV-' || yr || '-[0-9]{4}$');
  return 'INV-' || yr || '-' || lpad(cnt::text, 4, '0');
end; $$ language plpgsql security definer set search_path = public;

-- ============ 2. Version-guarded job updates ============
-- Optimistic concurrency: the client sends the version it based its edit on.
-- If another device changed the job since, the WHERE misses and an empty
-- result is returned — the client marks the outbox row 'failed' with a
-- visible "version conflict" error instead of silently clobbering.
-- Partial payloads are supported: keys absent from p_job keep their current
-- server values (to_jsonb(row) || p_job).
-- RLS stays active (security invoker) — the initial SELECT enforces
-- company membership via jobs_company_crud.
create or replace function public.update_job_safe(p_job jsonb, p_expected_version integer)
returns setof public.jobs
language plpgsql
as $$
declare
  v_job public.jobs;
  v_merged jsonb;
begin
  if p_job is null or p_job->>'id' is null or p_expected_version is null then
    return;
  end if;

  select * into v_job
    from public.jobs
   where id = (p_job->>'id')::uuid
     and version = p_expected_version
     for update;

  if not found then
    return; -- conflict (stale version) or no access — caller sees []
  end if;

  v_merged := to_jsonb(v_job) || p_job;
  v_merged := jsonb_set(v_merged, '{version}', to_jsonb(v_job.version + 1));
  v_merged := jsonb_set(v_merged, '{updated_at}', to_jsonb(now()));

  update public.jobs j
     set customer_name   = v_merged->>'customer_name',
         customer_phone  = v_merged->>'customer_phone',
         customer_email  = v_merged->>'customer_email',
         address         = v_merged->>'address',
         lat             = (v_merged->>'lat')::double precision,
         lng             = (v_merged->>'lng')::double precision,
         title           = v_merged->>'title',
         description     = v_merged->>'description',
         status          = (v_merged->>'status')::job_status,
         scheduled_at    = nullif(v_merged->>'scheduled_at', '')::timestamptz,
         started_at      = nullif(v_merged->>'started_at', '')::timestamptz,
         completed_at    = nullif(v_merged->>'completed_at', '')::timestamptz,
         materials       = coalesce(v_merged->'materials', j.materials),
         notes           = v_merged->>'notes',
         version         = (v_merged->>'version')::int,
         updated_at      = now()
   where j.id = v_job.id;

  return query select * from public.jobs where id = v_job.id;
end; $$;
