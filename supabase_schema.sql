-- Urlaubsplaner 5.0 / Supabase
create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_app_state enable row level security;

drop policy if exists "read own app state" on public.user_app_state;
create policy "read own app state"
on public.user_app_state for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "insert own app state" on public.user_app_state;
create policy "insert own app state"
on public.user_app_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "update own app state" on public.user_app_state;
create policy "update own app state"
on public.user_app_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "delete own app state" on public.user_app_state;
create policy "delete own app state"
on public.user_app_state for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_app_state to authenticated;


-- Version 5.1: gemeinsame Reisen mit Rollen
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id,email) values(new.id,new.email)
  on conflict(id) do update set email=excluded.email;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users
for each row execute procedure public.handle_new_user();

insert into public.profiles(id,email)
select id,email from auth.users
on conflict(id) do update set email=excluded.email;

drop policy if exists "authenticated can lookup profiles" on public.profiles;
create policy "authenticated can lookup profiles" on public.profiles for select to authenticated using (true);
grant select on public.profiles to authenticated;

create table if not exists public.shared_trips (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null,
 trip_data jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 unique(owner_id,title)
);
create table if not exists public.trip_members (
 trip_id uuid not null references public.shared_trips(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('editor','viewer')),
 created_at timestamptz not null default now(),
 primary key(trip_id,user_id)
);
alter table public.shared_trips enable row level security;
alter table public.trip_members enable row level security;

create or replace function public.can_view_trip(p_trip uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from shared_trips t where t.id=p_trip and (t.owner_id=auth.uid() or exists(select 1 from trip_members m where m.trip_id=t.id and m.user_id=auth.uid()))); $$;

create or replace function public.can_edit_trip(p_trip uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from shared_trips t where t.id=p_trip and (t.owner_id=auth.uid() or exists(select 1 from trip_members m where m.trip_id=t.id and m.user_id=auth.uid() and m.role='editor'))); $$;

drop policy if exists "owners insert trips" on public.shared_trips;
create policy "owners insert trips" on public.shared_trips for insert to authenticated with check(owner_id=auth.uid());
drop policy if exists "members view trips" on public.shared_trips;
create policy "members view trips" on public.shared_trips for select to authenticated using(public.can_view_trip(id));
drop policy if exists "editors update trips" on public.shared_trips;
create policy "editors update trips" on public.shared_trips for update to authenticated using(public.can_edit_trip(id)) with check(public.can_edit_trip(id));
drop policy if exists "owners delete trips" on public.shared_trips;
create policy "owners delete trips" on public.shared_trips for delete to authenticated using(owner_id=auth.uid());

drop policy if exists "members view membership" on public.trip_members;
create policy "members view membership" on public.trip_members for select to authenticated using(user_id=auth.uid() or exists(select 1 from shared_trips t where t.id=trip_id and t.owner_id=auth.uid()));
drop policy if exists "owners manage membership" on public.trip_members;
create policy "owners manage membership" on public.trip_members for all to authenticated
using(exists(select 1 from shared_trips t where t.id=trip_id and t.owner_id=auth.uid()))
with check(exists(select 1 from shared_trips t where t.id=trip_id and t.owner_id=auth.uid()));

grant select,insert,update,delete on public.shared_trips to authenticated;
grant select,insert,update,delete on public.trip_members to authenticated;

create or replace function public.invite_trip_member(p_trip_id uuid,p_email text,p_role text)
returns void language plpgsql security definer set search_path=public
as $$
declare target uuid;
begin
 if not exists(select 1 from shared_trips where id=p_trip_id and owner_id=auth.uid()) then raise exception 'Nur der Besitzer darf Personen einladen'; end if;
 if p_role not in ('editor','viewer') then raise exception 'Ungültige Rolle'; end if;
 select id into target from profiles where lower(email)=lower(p_email);
 if target is null then raise exception 'Für diese E-Mail existiert noch kein Urlaubsplaner-Konto'; end if;
 if target=auth.uid() then raise exception 'Der Besitzer muss nicht eingeladen werden'; end if;
 insert into trip_members(trip_id,user_id,role) values(p_trip_id,target,p_role)
 on conflict(trip_id,user_id) do update set role=excluded.role;
end; $$;
grant execute on function public.invite_trip_member(uuid,text,text) to authenticated;

create or replace view public.shared_trip_access
with (security_invoker=true)
as
select t.id trip_id,t.title,t.trip_data,t.updated_at,t.owner_id=p.id as is_owner,
case when t.owner_id=p.id then 'owner' else m.role end role,
op.email owner_email
from profiles p
join shared_trips t on t.owner_id=p.id or exists(select 1 from trip_members mm where mm.trip_id=t.id and mm.user_id=p.id)
left join trip_members m on m.trip_id=t.id and m.user_id=p.id
left join profiles op on op.id=t.owner_id
where p.id=auth.uid();
grant select on public.shared_trip_access to authenticated;
