-- FieldOps — 002: Email auth support
-- Adds email to users (email OTP / magic-link login works out of the box, no SMS provider)
-- and updates the auto-user trigger to capture email signups.

alter table public.users
  add column if not exists email text unique;

create index if not exists idx_users_email on public.users(email);

-- Replace trigger function to capture both email and phone signups.
create or replace function public.handle_new_auth_user() returns trigger as $$
begin
  insert into public.users (id, display_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.phone, ''),
    nullif(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end; $$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();