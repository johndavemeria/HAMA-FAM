-- ============================================================
-- Hama — Migration 2: open sign-in + locked-down privileged fields
-- Run this ONCE in Supabase → SQL Editor on your EXISTING project.
-- Safe to run even if you've never run it before — it only adds/replaces
-- things, it does not touch your existing profiles or family_relations.
-- ============================================================

-- 1. Allow the "Hama" badge value (older schema only allowed
--    Tubero / PvP Main / Founder).
alter table public.profiles drop constraint if exists profiles_badge_check;
alter table public.profiles add constraint profiles_badge_check
  check (badge in ('Hama','Tubero','PvP Main','Founder'));

-- 2. New members should default to generation 2 (unplaced) rather than 1,
--    so they don't show up as tree roots until a founder places them.
alter table public.profiles alter column generation set default 2;

-- 3. Lock down privileged columns so a normal member can't grant
--    themselves founder/admin, flip is_root, or change their own
--    generation by calling the API directly.
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

-- 4. Open sign-in: anyone can now sign in with Discord. If there's a
--    pre-registered row for their username it gets claimed as before;
--    otherwise a fresh "member" profile is created automatically instead
--    of rejecting the sign-in.
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

-- 5. Bootstrap: if you're the only founder and this is the first time
--    you're running this migration, you're already a founder from the old
--    pre-registration flow, so nothing else to do. If you ever need to
--    promote someone by hand instead of using the new Admin page:
-- update public.profiles set role = 'founder', badge = 'Founder',
--   generation = 1, is_root = true
-- where discord_username = 'their-discord-username';