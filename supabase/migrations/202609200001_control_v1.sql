-- Control plane only. Never store CNIE, OCR, case content or DOCX here.
create table public.control_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.control_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  created_at timestamptz not null default now()
);

create table public.control_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.control_organizations(id),
  role text not null check (role in ('holder', 'operator')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index control_memberships_organization_idx
  on public.control_memberships (organization_id) where active;

create table public.control_entitlements (
  organization_id uuid primary key references public.control_organizations(id),
  station_limit smallint not null check (station_limit between 1 and 3),
  ends_at timestamptz not null,
  suspended boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.control_stations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.control_organizations(id),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  public_key text not null unique check (char_length(public_key) = 43),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  app_version text check (app_version is null or char_length(app_version) <= 40)
);
create index control_stations_active_idx
  on public.control_stations (organization_id) where active;

create table public.control_station_challenges (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.control_stations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nonce_hash text not null unique check (char_length(nonce_hash) = 43),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  consumed_at timestamptz
);
create index control_station_challenges_expiry_idx
  on public.control_station_challenges (expires_at);

create table public.control_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.control_organizations(id),
  actor_user_id uuid references auth.users(id),
  action text not null check (action in (
    'organization_created', 'member_invited', 'member_restored', 'member_revoked',
    'station_activated', 'station_deactivated', 'entitlement_updated', 'lease_issued'
  )),
  target_id uuid,
  occurred_at timestamptz not null default now()
);
create index control_audit_events_organization_idx
  on public.control_audit_events (organization_id, occurred_at desc);

-- All tenant data is accessed through the authenticated control API. Browser
-- clients receive no direct table privileges; server secrets never leave it.
alter table public.control_platform_admins enable row level security;
alter table public.control_organizations enable row level security;
alter table public.control_memberships enable row level security;
alter table public.control_entitlements enable row level security;
alter table public.control_stations enable row level security;
alter table public.control_station_challenges enable row level security;
alter table public.control_audit_events enable row level security;
revoke all on public.control_platform_admins, public.control_organizations,
  public.control_memberships, public.control_entitlements, public.control_stations,
  public.control_station_challenges, public.control_audit_events
  from anon, authenticated;

create function public.control_is_platform_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.control_platform_admins where user_id = p_user_id);
$$;

create function public.control_create_organization(
  p_actor uuid, p_name text, p_station_limit smallint, p_ends_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.control_is_platform_admin(p_actor) then
    raise exception 'CONTROL_FORBIDDEN';
  end if;
  if p_ends_at <= now() then
    raise exception 'CONTROL_INVALID_ENTITLEMENT';
  end if;
  insert into public.control_organizations (name) values (btrim(p_name)) returning id into v_id;
  insert into public.control_entitlements (organization_id, station_limit, ends_at)
    values (v_id, p_station_limit, p_ends_at);
  insert into public.control_audit_events (organization_id, actor_user_id, action, target_id)
    values (v_id, p_actor, 'organization_created', v_id);
  return v_id;
end;
$$;

create function public.control_add_member(
  p_actor uuid, p_organization_id uuid, p_user_id uuid, p_role text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_existing public.control_memberships%rowtype; v_action text;
begin
  if p_role not in ('holder', 'operator') then
    raise exception 'CONTROL_INVALID_ROLE';
  end if;
  perform 1 from auth.users where id = p_user_id for update;
  if not found then raise exception 'CONTROL_MEMBER_NOT_FOUND'; end if;
  if public.control_is_platform_admin(p_user_id) then
    raise exception 'CONTROL_MEMBER_CONFLICT';
  end if;
  if not public.control_is_platform_admin(p_actor) and not exists (
    select 1 from public.control_memberships
    where user_id = p_actor and organization_id = p_organization_id
      and role = 'holder' and active
  ) then
    raise exception 'CONTROL_FORBIDDEN';
  end if;
  if p_role = 'holder' and not public.control_is_platform_admin(p_actor) then
    raise exception 'CONTROL_FORBIDDEN';
  end if;
  select * into v_existing from public.control_memberships where user_id = p_user_id for update;
  if found then
    if v_existing.organization_id <> p_organization_id or v_existing.role <> p_role or v_existing.active then
      raise exception 'CONTROL_MEMBER_CONFLICT';
    end if;
    update public.control_memberships set active = true where user_id = p_user_id;
    v_action := 'member_restored';
  else
    insert into public.control_memberships (user_id, organization_id, role)
      values (p_user_id, p_organization_id, p_role);
    v_action := 'member_invited';
  end if;
  insert into public.control_audit_events (organization_id, actor_user_id, action, target_id)
    values (p_organization_id, p_actor, v_action, p_user_id);
end;
$$;

create function public.control_revoke_member(p_actor uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member public.control_memberships%rowtype;
begin
  select * into v_member from public.control_memberships where user_id = p_user_id for update;
  if not found then raise exception 'CONTROL_MEMBER_NOT_FOUND'; end if;
  if not public.control_is_platform_admin(p_actor) and not exists (
    select 1 from public.control_memberships
    where user_id = p_actor and organization_id = v_member.organization_id
      and role = 'holder' and active
  ) then raise exception 'CONTROL_FORBIDDEN'; end if;
  if v_member.role = 'holder' and not public.control_is_platform_admin(p_actor) then
    raise exception 'CONTROL_FORBIDDEN';
  end if;
  if v_member.active then
    update public.control_memberships set active = false where user_id = p_user_id;
    insert into public.control_audit_events (organization_id, actor_user_id, action, target_id)
      values (v_member.organization_id, p_actor, 'member_revoked', p_user_id);
  end if;
end;
$$;

create function public.control_set_entitlement(
  p_actor uuid, p_organization_id uuid, p_station_limit smallint,
  p_ends_at timestamptz, p_suspended boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.control_is_platform_admin(p_actor) then
    raise exception 'CONTROL_FORBIDDEN';
  end if;
  if p_ends_at <= now() then raise exception 'CONTROL_INVALID_ENTITLEMENT'; end if;
  perform 1 from public.control_entitlements
    where organization_id = p_organization_id for update;
  if not found then raise exception 'CONTROL_ORGANIZATION_NOT_FOUND'; end if;
  if (select count(*) from public.control_stations
      where organization_id = p_organization_id and active) > p_station_limit then
    raise exception 'CONTROL_STATION_LIMIT';
  end if;
  update public.control_entitlements set station_limit = p_station_limit,
    ends_at = p_ends_at, suspended = p_suspended, updated_at = now()
    where organization_id = p_organization_id;
  if not found then raise exception 'CONTROL_ORGANIZATION_NOT_FOUND'; end if;
  insert into public.control_audit_events (organization_id, actor_user_id, action, target_id)
    values (p_organization_id, p_actor, 'entitlement_updated', p_organization_id);
end;
$$;

create function public.control_activate_station(
  p_actor uuid, p_label text, p_public_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_limit smallint; v_ends timestamptz; v_suspended boolean;
  v_existing public.control_stations%rowtype; v_id uuid;
begin
  select organization_id into v_org from public.control_memberships
    where user_id = p_actor and role = 'holder' and active;
  if v_org is null then raise exception 'CONTROL_FORBIDDEN'; end if;
  select station_limit, ends_at, suspended into v_limit, v_ends, v_suspended
    from public.control_entitlements where organization_id = v_org for update;
  if v_suspended or v_ends <= now() then raise exception 'CONTROL_ENTITLEMENT_INACTIVE'; end if;
  select * into v_existing from public.control_stations where public_key = p_public_key;
  if found then
    if v_existing.organization_id = v_org and v_existing.active then return v_existing.id; end if;
    raise exception 'CONTROL_STATION_KEY_IN_USE';
  end if;
  if (select count(*) from public.control_stations where organization_id = v_org and active) >= v_limit then
    raise exception 'CONTROL_STATION_LIMIT';
  end if;
  insert into public.control_stations (organization_id, label, public_key)
    values (v_org, btrim(p_label), p_public_key) returning id into v_id;
  insert into public.control_audit_events (organization_id, actor_user_id, action, target_id)
    values (v_org, p_actor, 'station_activated', v_id);
  return v_id;
end;
$$;

create function public.control_deactivate_station(p_actor uuid, p_station_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_station public.control_stations%rowtype;
begin
  select * into v_station from public.control_stations where id = p_station_id for update;
  if not found then raise exception 'CONTROL_STATION_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.control_memberships where user_id = p_actor
      and organization_id = v_station.organization_id and role = 'holder' and active
  ) then raise exception 'CONTROL_FORBIDDEN'; end if;
  if v_station.active then
    update public.control_stations set active = false where id = p_station_id;
    insert into public.control_audit_events (organization_id, actor_user_id, action, target_id)
      values (v_station.organization_id, p_actor, 'station_deactivated', p_station_id);
  end if;
end;
$$;

create function public.control_create_challenge(
  p_actor uuid, p_station_id uuid, p_nonce_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_station public.control_stations%rowtype; v_ent public.control_entitlements%rowtype;
  v_id uuid;
begin
  select * into v_station from public.control_stations where id = p_station_id and active;
  if not found then raise exception 'CONTROL_STATION_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.control_memberships where user_id = p_actor
      and organization_id = v_station.organization_id and active
  ) then raise exception 'CONTROL_FORBIDDEN'; end if;
  select * into v_ent from public.control_entitlements
    where organization_id = v_station.organization_id;
  if v_ent.suspended or v_ent.ends_at + interval '24 hours' <= now() then
    raise exception 'CONTROL_ENTITLEMENT_INACTIVE';
  end if;
  delete from public.control_station_challenges where expires_at < now() - interval '1 day';
  insert into public.control_station_challenges (station_id, user_id, nonce_hash)
    values (p_station_id, p_actor, p_nonce_hash) returning id into v_id;
  return v_id;
end;
$$;

create function public.control_consume_challenge(
  p_actor uuid, p_station_id uuid, p_challenge_id uuid, p_nonce_hash text,
  p_app_version text
) returns table (organization_id uuid, role text, ends_at timestamptz, public_key text)
language plpgsql security definer set search_path = '' as $$
declare v_challenge public.control_station_challenges%rowtype;
begin
  select * into v_challenge from public.control_station_challenges
    where id = p_challenge_id for update;
  if not found or v_challenge.station_id <> p_station_id or
      v_challenge.user_id <> p_actor or v_challenge.nonce_hash <> p_nonce_hash or
      v_challenge.consumed_at is not null or v_challenge.expires_at <= now() then
    raise exception 'CONTROL_CHALLENGE_INVALID';
  end if;
  update public.control_station_challenges set consumed_at = now() where id = p_challenge_id;
  update public.control_stations set last_seen_at = now(), app_version = p_app_version
    where id = p_station_id and active;
  if not found then raise exception 'CONTROL_STATION_NOT_FOUND'; end if;
  return query
    select s.organization_id, m.role, e.ends_at, s.public_key
    from public.control_stations s
    join public.control_memberships m on m.organization_id = s.organization_id
    join public.control_entitlements e on e.organization_id = s.organization_id
    where s.id = p_station_id and m.user_id = p_actor and m.active
      and not e.suspended and e.ends_at + interval '24 hours' > now();
  if not found then raise exception 'CONTROL_ENTITLEMENT_INACTIVE'; end if;
  insert into public.control_audit_events (organization_id, actor_user_id, action, target_id)
    select organization_id, p_actor, 'lease_issued', p_station_id
    from public.control_stations where id = p_station_id;
end;
$$;

revoke all on function public.control_is_platform_admin(uuid) from public, anon, authenticated;
revoke all on function public.control_create_organization(uuid, text, smallint, timestamptz) from public, anon, authenticated;
revoke all on function public.control_add_member(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.control_revoke_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.control_set_entitlement(uuid, uuid, smallint, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.control_activate_station(uuid, text, text) from public, anon, authenticated;
revoke all on function public.control_deactivate_station(uuid, uuid) from public, anon, authenticated;
revoke all on function public.control_create_challenge(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.control_consume_challenge(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.control_is_platform_admin(uuid) to service_role;
grant execute on function public.control_create_organization(uuid, text, smallint, timestamptz) to service_role;
grant execute on function public.control_add_member(uuid, uuid, uuid, text) to service_role;
grant execute on function public.control_revoke_member(uuid, uuid) to service_role;
grant execute on function public.control_set_entitlement(uuid, uuid, smallint, timestamptz, boolean) to service_role;
grant execute on function public.control_activate_station(uuid, text, text) to service_role;
grant execute on function public.control_deactivate_station(uuid, uuid) to service_role;
grant execute on function public.control_create_challenge(uuid, uuid, text) to service_role;
grant execute on function public.control_consume_challenge(uuid, uuid, uuid, text, text) to service_role;
