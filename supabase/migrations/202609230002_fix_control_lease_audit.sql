-- Qualify the station column because the RETURNS TABLE output parameter is
-- also named organization_id inside PL/pgSQL.
create or replace function public.control_consume_challenge(
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
    select station.organization_id, membership.role, entitlement.ends_at, station.public_key
    from public.control_stations as station
    join public.control_memberships as membership
      on membership.organization_id = station.organization_id
    join public.control_entitlements as entitlement
      on entitlement.organization_id = station.organization_id
    where station.id = p_station_id and membership.user_id = p_actor and membership.active
      and not entitlement.suspended and entitlement.ends_at + interval '24 hours' > now();
  if not found then raise exception 'CONTROL_ENTITLEMENT_INACTIVE'; end if;
  insert into public.control_audit_events (organization_id, actor_user_id, action, target_id)
    select station.organization_id, p_actor, 'lease_issued', p_station_id
    from public.control_stations as station where station.id = p_station_id;
end;
$$;

revoke all on function public.control_consume_challenge(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.control_consume_challenge(uuid, uuid, uuid, text, text)
  to service_role;
