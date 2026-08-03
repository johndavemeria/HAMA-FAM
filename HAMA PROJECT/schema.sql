-- ============================================================
-- Tubero Family — Supabase schema
-- Run this once in Supabase → SQL Editor → New query → Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- PROFILES ----------
-- One row per family member. Anyone can sign in with Discord — the first
-- sign-in auto-creates a normal "member" row (see handle_discord_login
-- below). Founders/admins then place people into the family tree and can
-- promote roles from the Admin page. A founder/admin can also still
-- pre-register a row by discord_username ahead of time if they want to;
-- the same row gets claimed automatically when that person signs in.
create table if not exists public.profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid unique references auth.users(id) on delete set null,
  discord_id      text unique,
  discord_username text not null,               -- lowercase, e.g. "praryo"
  display_name    text not null,
  avatar_url      text,
  banner_url      text,
  bio             text default '',
  role            text not null default 'member' check (role in ('founder','admin','member')),
  badge           text not null default 'Hama' check (badge in ('Hama','Tubero','PvP Main','Founder')),
  generation      int  not null default 2,
  is_root         boolean not null default false, -- can grow the tree from their own card
  links           jsonb not null default '[]'::jsonb,   -- [{ "label": "...", "url": "...", "icon": "..." }]
  sections        jsonb not null default '[]'::jsonb,   -- [{ "title": "My Rig", "items": [{"label":"CPU","value":"..."}] }]
  created_at      timestamptz not null default now()
);

create unique index if not exists profiles_discord_username_lower_idx
  on public.profiles (lower(discord_username));

-- ---------- FAMILY RELATIONS ----------
-- owner_id = the root/admin card the relation is attached to
-- member_id = the spouse or child profile
create table if not exists public.family_relations (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  member_id     uuid not null references public.profiles(id) on delete cascade,
  relation_type text not null check (relation_type in ('spouse','child')),
  created_at    timestamptz not null default now(),
  unique (owner_id, member_id, relation_type)
);

-- ---------- Helper: is the current user a founder/admin? ----------
create or replace function public.is_staff(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = uid and role in ('founder','admin')
  );
$$;

-- ---------- Helper: is the current user the root of this profile? ----------
create or replace function public.is_root_owner(uid uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_profile_id and user_id = uid and is_root = true
  );
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.family_relations enable row level security;

-- Public read access (the whole point of the site is a public directory)
drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read" on public.profiles
  for select using (true);

drop policy if exists "relations_public_read" on public.family_relations;
create policy "relations_public_read" on public.family_relations
  for select using (true);

-- A signed-in member can edit their own claimed profile (bio/links/sections/badge display info)
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Founders/admins can add brand-new (pre-registered) family members,
-- and so can any 1st-generation ROOT (to grow their own branch)
drop policy if exists "profiles_staff_insert" on public.profiles;
create policy "profiles_staff_insert" on public.profiles
  for insert with check (
    public.is_staff(auth.uid())
    or exists (select 1 from public.profiles where user_id = auth.uid() and is_root = true)
  );

-- Founders/admins can edit any profile (fix typos, set generation, etc.)
drop policy if exists "profiles_staff_update" on public.profiles;
create policy "profiles_staff_update" on public.profiles
  for update using (public.is_staff(auth.uid()));

-- Founders/admins can remove a profile
drop policy if exists "profiles_staff_delete" on public.profiles;
create policy "profiles_staff_delete" on public.profiles
  for delete using (public.is_staff(auth.uid()));

-- Only a 1st-generation ROOT can grow their OWN card, or staff can grow any card
drop policy if exists "relations_owner_insert" on public.family_relations;
create policy "relations_owner_insert" on public.family_relations
  for insert with check (
    public.is_root_owner(auth.uid(), owner_id) or public.is_staff(auth.uid())
  );

drop policy if exists "relations_owner_delete" on public.family_relations;
create policy "relations_owner_delete" on public.family_relations
  for delete using (
    public.is_root_owner(auth.uid(), owner_id) or public.is_staff(auth.uid())
  );

-- ---------- Trigger: lock down privileged columns ----------
-- The "profiles_self_update" policy above lets a signed-in member update
-- their OWN row (so they can edit bio/links/sections). Row Level Security
-- alone can't restrict that to specific *columns* — without this trigger,
-- a member could call the API directly and set their own role to
-- 'founder', flip is_root, or bump their generation. This trigger silently
-- reverts those specific fields back to their previous value unless the
-- person making the change is a founder/admin.
create or replace function public.protect_privileged_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff(auth.uid()) then
    new.role       := old.role;
    new.badge      := old.badge;
    new.generation := old.generation;
    new.is_root    := old.is_root;
    new.user_id    := old.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_privileged_profile_fields on public.profiles;
create trigger trg_protect_privileged_profile_fields
  before update on public.profiles
  for each row execute function public.protect_privileged_profile_fields();

-- ---------- RPC: claim / refresh a profile on Discord login ----------
-- Called right after a successful Discord sign-in.
--  1. If this Discord account already owns a profile, refresh its live
--     Discord data (avatar/banner/username) and return it.
--  2. Else if a founder/admin pre-registered a row for this exact
--     discord_username ahead of time, claim that row.
--  3. Else, create a brand-new "member" profile for them automatically —
--     sign-in is open to anyone. New members start at generation 2,
--     not placed in the family tree, until a founder/admin places them
--     from the Admin page.
create or replace function public.handle_discord_login(
  p_discord_id text,
  p_discord_username text,
  p_display_name text,
  p_avatar_url text,
  p_banner_url text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Already claimed by this user -> just refresh live discord data
  select * into v_profile from public.profiles where user_id = v_uid;

  if found then
    update public.profiles
      set discord_id = p_discord_id,
          discord_username = p_discord_username,
          avatar_url = p_avatar_url,
          banner_url = p_banner_url
      where user_id = v_uid
      returning * into v_profile;
    return v_profile;
  end if;

  -- Not claimed yet -> look for a pre-registered, unclaimed row by username
  select * into v_profile
    from public.profiles
    where lower(discord_username) = lower(p_discord_username)
      and user_id is null
    limit 1;

  if found then
    update public.profiles
      set user_id = v_uid,
          discord_id = p_discord_id,
          avatar_url = p_avatar_url,
          banner_url = p_banner_url,
          display_name = coalesce(nullif(display_name, ''), p_display_name)
      where id = v_profile.id
      returning * into v_profile;
    return v_profile;
  end if;

  -- No pre-registered row -> anyone can sign in, so create a fresh
  -- ordinary member profile for them.
  insert into public.profiles (
    user_id, discord_id, discord_username, display_name,
    avatar_url, banner_url, role, badge, generation, is_root
  )
  values (
    v_uid, p_discord_id, p_discord_username, p_display_name,
    p_avatar_url, p_banner_url, 'member', 'Hama', 2, false
  )
  returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.handle_discord_login(text, text, text, text, text) to authenticated;

-- ---------- Bootstrap: make yourself the first founder ----------
-- Sign-in is open to anyone now, so the very first time you sign in with
-- Discord, you'll get created as an ordinary 'member' automatically.
-- Run this once afterward (SQL Editor) to promote that row to founder —
-- from then on you can promote everyone else from the Admin page instead:
-- update public.profiles set role = 'founder', badge = 'Founder',
--   generation = 1, is_root = true
-- where discord_username = 'your-discord-username';