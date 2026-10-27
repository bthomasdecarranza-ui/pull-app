-- =====================================================================
-- PULL — database setup. Paste the whole file into
-- Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to run once on a fresh project.
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- Week boundary: Monday 00:00 Boston time ----------
create or replace function public.week_start() returns timestamptz
language sql stable as $$
  select (date_trunc('week', (now() at time zone 'America/New_York')) at time zone 'America/New_York');
$$;

-- ---------- Profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  roles text[] not null default '{}',
  specialty text not null default '',
  semester text not null default '',
  what_i_do text not null default '',
  what_i_want text not null default '',
  spotify text not null default '',
  soundcloud text not null default '',
  instagram text not null default '',
  tiktok text not null default '',
  avatar_url text,
  color text not null default '#FF6A2B',
  created_at timestamptz not null default now(),
  constraint roles_valid check (roles <@ array['artist','musician','producer','engineer','md']::text[])
);

-- Only @berklee.edu can sign up — enforced on auth.users itself.
create or replace function public.enforce_berklee_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or lower(new.email) !~ '@berklee\.edu$' then
    raise exception 'Only @berklee.edu emails can join Pull';
  end if;
  return new;
end $$;
drop trigger if exists berklee_only on auth.users;
create trigger berklee_only before insert on auth.users
  for each row execute function public.enforce_berklee_email();

-- Create the profile row when a user signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  palette text[] := array['#FF6A2B','#6AA6FF','#53D39A','#F2C94C','#C56AFF','#FF6A9E','#4FD1D9','#FFA14F'];
begin
  insert into public.profiles (id, email, name, color)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name',''),
          palette[1 + (abs(hashtext(new.id::text)) % array_length(palette,1))]);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Work (audio posts) ----------
create table if not exists public.works (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 80),
  type text not null check (type in ('Snippet','Demo','Session','Live','Mix')),
  path text not null,
  duration numeric,
  created_at timestamptz not null default now()
);

-- ---------- Asks ----------
create table if not exists public.asks (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  make_type text not null check (make_type in ('Session','Track','Reel','Gig','Show')),
  pitch text not null default '' check (length(pitch) <= 400),
  work_id uuid references public.works(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','passed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint no_self_ask check (from_id <> to_id)
);
create index if not exists asks_to_idx on public.asks(to_id, created_at);
create index if not exists asks_from_idx on public.asks(from_id, created_at);

-- ---------- Collabs (one per accepted ask) ----------
create table if not exists public.collabs (
  id uuid primary key default gen_random_uuid(),
  ask_id uuid not null unique references public.asks(id) on delete cascade,
  a_id uuid not null references public.profiles(id) on delete cascade, -- asker
  b_id uuid not null references public.profiles(id) on delete cascade, -- acceptor
  make_type text not null,
  status text not null default 'open' check (status in ('open','done','confirmed')),
  done_by uuid references public.profiles(id),
  work_id uuid references public.works(id) on delete set null,
  confirmed_by uuid references public.profiles(id),
  done_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Pull points ledger ----------
create table if not exists public.pull_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  other_id uuid references public.profiles(id) on delete set null,
  collab_id uuid references public.collabs(id) on delete cascade,
  points int not null,
  created_at timestamptz not null default now()
);
create index if not exists pull_user_idx on public.pull_events(user_id, created_at);

-- ---------- Open calls ----------
create table if not exists public.open_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 80),
  need text not null check (length(need) between 1 and 200),
  make_type text not null check (make_type in ('Session','Track','Reel','Gig','Show')),
  work_id uuid references public.works(id) on delete set null,
  is_open boolean not null default true,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Row Level Security (ON for every table)
-- =====================================================================
alter table public.profiles    enable row level security;
alter table public.works       enable row level security;
alter table public.asks        enable row level security;
alter table public.collabs     enable row level security;
alter table public.pull_events enable row level security;
alter table public.open_calls  enable row level security;

drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select to authenticated using (true);
create policy "profiles update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "works read"   on public.works;
drop policy if exists "works insert" on public.works;
drop policy if exists "works update" on public.works;
drop policy if exists "works delete" on public.works;
create policy "works read"   on public.works for select to authenticated using (true);
create policy "works insert" on public.works for insert to authenticated with check (user_id = auth.uid());
create policy "works update" on public.works for update to authenticated using (user_id = auth.uid());
create policy "works delete" on public.works for delete to authenticated using (user_id = auth.uid());

-- Asks: receiver sees their own; accepts are public; passes are private.
-- Senders read their asks through the sent_asks view (passes look like Waiting forever).
drop policy if exists "asks read" on public.asks;
create policy "asks read" on public.asks for select to authenticated
  using (to_id = auth.uid() or status = 'accepted');
-- No insert/update policies: writes only go through send_ask / decide_ask.

drop policy if exists "collabs read" on public.collabs;
create policy "collabs read" on public.collabs for select to authenticated
  using (status = 'confirmed' or a_id = auth.uid() or b_id = auth.uid());

drop policy if exists "pull read" on public.pull_events;
create policy "pull read" on public.pull_events for select to authenticated using (true);

drop policy if exists "calls read"   on public.open_calls;
drop policy if exists "calls insert" on public.open_calls;
drop policy if exists "calls update" on public.open_calls;
drop policy if exists "calls delete" on public.open_calls;
create policy "calls read"   on public.open_calls for select to authenticated using (true);
create policy "calls insert" on public.open_calls for insert to authenticated with check (user_id = auth.uid());
create policy "calls update" on public.open_calls for update to authenticated using (user_id = auth.uid());
create policy "calls delete" on public.open_calls for delete to authenticated using (user_id = auth.uid());

-- =====================================================================
-- Views
-- =====================================================================
-- Sent asks, as the sender is allowed to see them: a pass stays "pending".
create or replace view public.sent_asks as
  select a.id, a.from_id, a.to_id, a.make_type, a.pitch, a.work_id, a.created_at,
         case when a.status = 'accepted' then 'accepted' else 'pending' end as status,
         case when a.status = 'accepted' then a.decided_at end as decided_at
  from public.asks a
  where a.from_id = auth.uid();

-- The Board: Pull this week / all time, ranks, desire signal, accepts left.
create or replace view public.board as
  with pw as (
    select user_id,
           coalesce(sum(points) filter (where created_at >= public.week_start()), 0) as pull_week,
           coalesce(sum(points), 0) as pull_all
    from public.pull_events group by user_id),
  ar as (
    select to_id,
           count(*) filter (where created_at >= public.week_start()) as asks_week,
           count(*) filter (where status = 'accepted' and decided_at >= public.week_start()) as accepts_week,
           count(*) filter (where status = 'accepted') as accepts_all
    from public.asks group by to_id),
  cc as (
    select user_id, count(*) as collabs from (
      select a_id as user_id from public.collabs where status = 'confirmed'
      union all
      select b_id from public.collabs where status = 'confirmed') x
    group by user_id)
  select p.id, p.name, p.roles, p.specialty, p.semester, p.color, p.avatar_url, p.created_at,
         coalesce(pw.pull_week, 0)::int  as pull_week,
         coalesce(pw.pull_all, 0)::int   as pull_all,
         coalesce(ar.asks_week, 0)::int  as asks_received_week,
         coalesce(ar.accepts_week, 0)::int as accepts_used_week,
         greatest(0, 3 - coalesce(ar.accepts_week, 0))::int as accepts_left,
         coalesce(ar.accepts_all, 0)::int as accepts_all,
         coalesce(cc.collabs, 0)::int    as collabs,
         case when coalesce(pw.pull_week, 0) > 0 then
           rank() over (order by coalesce(pw.pull_week, 0) desc, coalesce(ar.asks_week, 0) desc, p.created_at) end::int as rank_week,
         case when coalesce(pw.pull_all, 0) > 0 then
           rank() over (order by coalesce(pw.pull_all, 0) desc, coalesce(ar.accepts_all, 0) desc, p.created_at) end::int as rank_all
  from public.profiles p
  left join pw on pw.user_id = p.id
  left join ar on ar.to_id = p.id
  left join cc on cc.user_id = p.id;

-- "Just happened" feed.
create or replace view public.feed as
  select 'member'::text as kind, p.id as id, p.created_at as at, p.id as actor_id,
         null::uuid as target_id, null::uuid as work_id, null::text as make_type
  from public.profiles p
  union all
  select 'accept', a.id, a.decided_at, a.to_id, a.from_id, null, a.make_type
  from public.asks a where a.status = 'accepted'
  union all
  select 'collab', c.id, c.confirmed_at, c.a_id, c.b_id, c.work_id, c.make_type
  from public.collabs c where c.status = 'confirmed'
  union all
  select 'board', e.id, e.created_at, e.user_id, null, null, null
  from (select distinct on (user_id) id, user_id, created_at
        from public.pull_events where created_at >= public.week_start()
        order by user_id, created_at) e;

revoke all on public.sent_asks, public.board, public.feed from anon;
grant select on public.sent_asks, public.board, public.feed to authenticated;

-- =====================================================================
-- Functions (limits live here, not in the browser)
-- =====================================================================
create or replace function public.my_limits() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'asks_left',    greatest(0, 5 - (select count(*) from public.asks where from_id = auth.uid() and created_at >= public.week_start())),
    'accepts_left', greatest(0, 3 - (select count(*) from public.asks where to_id = auth.uid() and status = 'accepted' and decided_at >= public.week_start())),
    'week_start',   public.week_start());
$$;

create or replace function public.send_ask(p_to uuid, p_make text, p_pitch text, p_work uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_from uuid := auth.uid(); v_id uuid; v_sent int;
begin
  if v_from is null then raise exception 'Sign in first'; end if;
  if p_to = v_from then raise exception 'You cannot ask yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_to) then raise exception 'That person is not on Pull'; end if;
  perform pg_advisory_xact_lock(hashtext(v_from::text));
  select count(*) into v_sent from public.asks where from_id = v_from and created_at >= public.week_start();
  if v_sent >= 5 then raise exception 'You have used your 5 asks this week'; end if;
  if exists (select 1 from public.asks where from_id = v_from and to_id = p_to and created_at >= public.week_start()) then
    raise exception 'You already asked this person this week';
  end if;
  if p_work is not null and not exists (select 1 from public.works where id = p_work and user_id = v_from) then
    raise exception 'Attach one of your own snippets';
  end if;
  insert into public.asks (from_id, to_id, make_type, pitch, work_id)
  values (v_from, p_to, p_make, coalesce(p_pitch, ''), p_work) returning id into v_id;
  return v_id;
end $$;

create or replace function public.decide_ask(p_ask uuid, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); a public.asks%rowtype; v_acc int;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  perform pg_advisory_xact_lock(hashtext(v_me::text));
  select * into a from public.asks where id = p_ask for update;
  if not found or a.to_id <> v_me then raise exception 'Not your ask'; end if;
  if a.status <> 'pending' then raise exception 'Already decided'; end if;
  if p_decision = 'accept' then
    select count(*) into v_acc from public.asks
      where to_id = v_me and status = 'accepted' and decided_at >= public.week_start();
    if v_acc >= 3 then raise exception 'You have used your 3 accepts this week'; end if;
    update public.asks set status = 'accepted', decided_at = now() where id = p_ask;
    insert into public.collabs (ask_id, a_id, b_id, make_type) values (p_ask, a.from_id, a.to_id, a.make_type);
  elsif p_decision = 'pass' then
    update public.asks set status = 'passed', decided_at = now() where id = p_ask;
  else
    raise exception 'Unknown decision';
  end if;
end $$;

create or replace function public.mark_done(p_collab uuid, p_work uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); c public.collabs%rowtype;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select * into c from public.collabs where id = p_collab for update;
  if not found or (c.a_id <> v_me and c.b_id <> v_me) then raise exception 'Not your collab'; end if;
  if c.status <> 'open' then raise exception 'Already marked done'; end if;
  if p_work is null then raise exception 'Attach the work'; end if;
  if not exists (select 1 from public.works where id = p_work and user_id in (c.a_id, c.b_id)) then
    raise exception 'Attach work posted by one of you';
  end if;
  update public.collabs set status = 'done', done_by = v_me, work_id = p_work, done_at = now() where id = p_collab;
end $$;

create or replace function public.confirm_collab(p_collab uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); c public.collabs%rowtype; pull_a int; pull_b int;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select * into c from public.collabs where id = p_collab for update;
  if not found or (c.a_id <> v_me and c.b_id <> v_me) then raise exception 'Not your collab'; end if;
  if c.status <> 'done' then raise exception 'Nothing to confirm yet'; end if;
  if c.done_by = v_me then raise exception 'The other person has to confirm'; end if;
  select coalesce(sum(points), 0) into pull_a from public.pull_events where user_id = c.a_id;
  select coalesce(sum(points), 0) into pull_b from public.pull_events where user_id = c.b_id;
  update public.collabs set status = 'confirmed', confirmed_by = v_me, confirmed_at = now() where id = p_collab;
  -- 10 points + 10% of the other person's all-time Pull, for both.
  insert into public.pull_events (user_id, other_id, collab_id, points) values
    (c.a_id, c.b_id, c.id, 10 + round(pull_b * 0.10)::int),
    (c.b_id, c.a_id, c.id, 10 + round(pull_a * 0.10)::int);
end $$;

revoke execute on function public.send_ask(uuid,text,text,uuid), public.decide_ask(uuid,text),
  public.mark_done(uuid,uuid), public.confirm_collab(uuid), public.my_limits() from anon;
grant execute on function public.send_ask(uuid,text,text,uuid), public.decide_ask(uuid,text),
  public.mark_done(uuid,uuid), public.confirm_collab(uuid), public.my_limits(), public.week_start() to authenticated;

-- =====================================================================
-- Storage: audio in "work", photos in "avatars"
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('work', 'work', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;
insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 5242880)
on conflict (id) do update set public = true, file_size_limit = 5242880;

drop policy if exists "pull media read"   on storage.objects;
drop policy if exists "pull media insert" on storage.objects;
drop policy if exists "pull media update" on storage.objects;
drop policy if exists "pull media delete" on storage.objects;
create policy "pull media read" on storage.objects for select to public
  using (bucket_id in ('work','avatars'));
create policy "pull media insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('work','avatars') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pull media update" on storage.objects for update to authenticated
  using (bucket_id in ('work','avatars') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pull media delete" on storage.objects for delete to authenticated
  using (bucket_id in ('work','avatars') and (storage.foldername(name))[1] = auth.uid()::text);
