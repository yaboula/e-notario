-- The control Edge Function is the only public entry point for control data.
-- Browser roles keep no table privileges. The server role still needs SELECT
-- privileges for the direct reads performed after authenticating each request.
grant select on table
  public.control_platform_admins,
  public.control_organizations,
  public.control_memberships,
  public.control_entitlements,
  public.control_stations
to service_role;
