import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { importPKCS8, SignJWT } from "npm:jose@6.2.12";
import { base64url, fromBase64url, isUuid, leaseWindow, stationProofMessage } from "./lib.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const secretKey = adminSecretKey();
if (!supabaseUrl || !secretKey) throw new Error("CONTROL_CONFIGURATION_MISSING");
const service = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function adminSecretKey(): string | undefined {
  const configured = Deno.env.get("CONTROL_SUPABASE_SECRET_KEY");
  if (configured) return configured;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, unknown>;
    return typeof keys.default === "string" ? keys.default : undefined;
  } catch {
    return undefined;
  }
}

function leasePrivateKeyPem(): string | undefined {
  const pem = Deno.env.get("CONTROL_LEASE_PRIVATE_KEY_PEM");
  if (pem) return pem.replaceAll("\\n", "\n");
  const encoded = Deno.env.get("CONTROL_LEASE_PRIVATE_KEY_PKCS8_B64");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return undefined;
  const lines = encoded.match(/.{1,64}/g);
  return lines ? `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n` : undefined;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Max-Age": "600",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: {
      ...cors, "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function must(condition: unknown, status: number, code: string): asserts condition {
  if (!condition) throw new ApiError(status, code);
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  must(!Number.isFinite(length) || length <= 16_384, 413, "CONTROL_BODY_TOO_LARGE");
  const raw = await request.text();
  must(raw.length <= 16_384, 413, "CONTROL_BODY_TOO_LARGE");
  try {
    const parsed: unknown = JSON.parse(raw);
    must(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
      400, "CONTROL_INVALID_BODY");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "CONTROL_INVALID_BODY");
  }
}

function dbError(error: { message: string; code?: string }): never {
  const known: Record<string, number> = {
    CONTROL_FORBIDDEN: 403, CONTROL_MEMBER_NOT_FOUND: 404,
    CONTROL_STATION_NOT_FOUND: 404, CONTROL_ORGANIZATION_NOT_FOUND: 404,
    CONTROL_INVALID_ENTITLEMENT: 400, CONTROL_INVALID_ROLE: 400,
    CONTROL_ENTITLEMENT_INACTIVE: 403, CONTROL_STATION_LIMIT: 409,
    CONTROL_STATION_KEY_IN_USE: 409, CONTROL_MEMBER_CONFLICT: 409,
    CONTROL_CHALLENGE_INVALID: 409,
  };
  for (const [code, status] of Object.entries(known)) {
    if (error.message.includes(code)) throw new ApiError(status, code);
  }
  if (error.code === "23505") throw new ApiError(409, "CONTROL_CONFLICT");
  if (error.code === "23514" || error.code === "23502") {
    throw new ApiError(400, "CONTROL_INVALID_BODY");
  }
  throw new ApiError(503, "CONTROL_STORAGE_UNAVAILABLE");
}

type Membership = { organization_id: string; role: "holder" | "operator"; active: boolean };
type Actor = { id: string; email: string; aal: string; membership: Membership | null; platform: boolean };

async function actor(request: Request): Promise<Actor> {
  const match = /^Bearer (\S+)$/i.exec(request.headers.get("authorization") ?? "");
  must(match, 401, "CONTROL_AUTH_REQUIRED");
  const token = match[1];
  const { data: userData, error: userError } = await service.auth.getUser(token);
  must(!userError && userData.user, 401, "CONTROL_AUTH_REQUIRED");
  const accountEmail = email(userData.user.email);
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64url(token.split(".")[1])));
  } catch {
    throw new ApiError(401, "CONTROL_AUTH_REQUIRED");
  }
  must(claims.sub === userData.user.id, 401, "CONTROL_AUTH_REQUIRED");
  const { data: membership, error: memberError } = await service
    .from("control_memberships").select("organization_id,role,active")
    .eq("user_id", userData.user.id).maybeSingle();
  if (memberError) dbError(memberError);
  const { data: admin, error: adminError } = await service
    .from("control_platform_admins").select("user_id")
    .eq("user_id", userData.user.id).maybeSingle();
  if (adminError) dbError(adminError);
  return { id: userData.user.id, email: accountEmail, aal: String(claims.aal ?? "aal1"),
    membership: membership?.active ? membership as Membership : null, platform: !!admin };
}

function platform(user: Actor): void {
  must(user.platform && user.aal === "aal2", 403, "CONTROL_FORBIDDEN");
}

function holder(user: Actor): asserts user is Actor & { membership: Membership } {
  must(user.membership?.role === "holder" && user.aal === "aal2", 403, "CONTROL_FORBIDDEN");
}

function member(user: Actor): asserts user is Actor & { membership: Membership } {
  must(user.membership, 403, "CONTROL_FORBIDDEN");
  if (user.membership.role === "holder") {
    must(user.aal === "aal2", 403, "CONTROL_MFA_REQUIRED");
  }
}

function email(value: unknown): string {
  must(typeof value === "string", 400, "CONTROL_INVALID_EMAIL");
  const normalized = value.trim().toLowerCase();
  must(normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized),
    400, "CONTROL_INVALID_EMAIL");
  return normalized;
}

function date(value: unknown): Date {
  must(typeof value === "string", 400, "CONTROL_INVALID_DATE");
  const parsed = new Date(value);
  must(Number.isFinite(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(value),
    400, "CONTROL_INVALID_DATE");
  return parsed;
}

async function rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await service.rpc(name, params);
  if (error) dbError(error);
  return data;
}

async function invite(actorId: string, organizationId: string, recipient: string,
                      role: "holder" | "operator") {
  const portalUrl = Deno.env.get("CONTROL_PORTAL_URL");
  must(portalUrl && /^https:\/\//.test(portalUrl), 503, "CONTROL_CONFIGURATION_MISSING");
  const redirectTo = `${portalUrl.replace(/\/$/, "")}/accept-invite`;
  const { data, error } = await service.auth.admin.inviteUserByEmail(recipient, {
    redirectTo,
  });
  let account = data.user ?? null;
  let recovered = false;
  let membershipExists = false;
  if (error || !account) {
    // Auth and Postgres cannot share a transaction. If Auth created the account but
    // membership persistence failed (or the response was lost), a retry must be able
    // to finish the invitation without deleting or re-creating that account.
    let page = 1;
    while (!account) {
      const listed = await service.auth.admin.listUsers({ page, perPage: 1000 });
      if (listed.error) throw new ApiError(503, "CONTROL_AUTH_UNAVAILABLE");
      account = listed.data.users.find(
        item => item.email?.trim().toLowerCase() === recipient) ?? null;
      if (account || listed.data.nextPage === null) break;
      page = listed.data.nextPage;
    }
    if (!account) throw new ApiError(409, "CONTROL_INVITE_FAILED");
    must(!account.last_sign_in_at, 409, "CONTROL_MEMBER_CONFLICT");
    const [{ data: membership, error: memberError }, { data: admin, error: adminError }] =
      await Promise.all([
        service.from("control_memberships").select("organization_id,role,active")
          .eq("user_id", account.id).maybeSingle(),
        service.from("control_platform_admins").select("user_id")
          .eq("user_id", account.id).maybeSingle(),
      ]);
    if (memberError) dbError(memberError);
    if (adminError) dbError(adminError);
    must(!admin && (!membership || (membership.active &&
      membership.organization_id === organizationId && membership.role === role)),
      409, "CONTROL_MEMBER_CONFLICT");
    membershipExists = !!membership;
    recovered = true;
  }
  if (!membershipExists) {
    await rpc("control_add_member", { p_actor: actorId,
      p_organization_id: organizationId, p_user_id: account.id, p_role: role });
  }
  if (recovered) {
    const reset = await service.auth.resetPasswordForEmail(recipient, {
      redirectTo: `${portalUrl.replace(/\/$/, "")}/recover`,
    });
    if (reset.error) throw new ApiError(409, "CONTROL_INVITE_FAILED");
  }
  return { user_id: account.id, email: recipient, role };
}

async function leaseToken(user: Actor, stationId: string, endsAt: string, role: string) {
  const pem = leasePrivateKeyPem();
  const keyId = Deno.env.get("CONTROL_LEASE_KEY_ID");
  must(pem && keyId && /^[A-Za-z0-9._-]{1,64}$/.test(keyId),
    503, "CONTROL_CONFIGURATION_MISSING");
  const now = Math.floor(Date.now() / 1000);
  const { newWorkUntil, finishUntil } = leaseWindow(now, Math.floor(Date.parse(endsAt) / 1000));
  const key = await importPKCS8(pem, "EdDSA");
  const token = await new SignJWT({ email: user.email,
    organization_id: user.membership!.organization_id,
    station_id: stationId, role, new_work_until: newWorkUntil,
    finish_until: finishUntil, grant_type: "local-work-v1" })
    .setProtectedHeader({ alg: "EdDSA", kid: keyId })
    .setIssuer("e-notario-control").setAudience("e-notario-local")
    .setSubject(user.id).setIssuedAt(now).setExpirationTime(finishUntil).sign(key);
  return { token, new_work_until: newWorkUntil, finish_until: finishUntil };
}

async function route(request: Request): Promise<Response> {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const root = segments.lastIndexOf("control-v1");
  must(root >= 0, 404, "CONTROL_NOT_FOUND");
  const path = segments.slice(root + 1);
  const user = await actor(request);
  const method = request.method;

  if (method === "GET" && path.join("/") === "me") {
    let organizationName: string | null = null;
    if (user.membership) {
      const { data, error } = await service.from("control_organizations")
        .select("name").eq("id", user.membership.organization_id).single();
      if (error) dbError(error);
      organizationName = data.name;
    }
    return json({ user_id: user.id, role: user.membership?.role ?? null,
      organization_id: user.membership?.organization_id ?? null,
      organization_name: organizationName,
      platform_admin: user.platform,
      mfa_required: (user.membership?.role === "holder" || user.platform) && user.aal !== "aal2" });
  }
  if (path[0] === "platform") {
    platform(user);
    if (method === "GET" && path.length === 2 && path[1] === "organizations") {
      const { data, error } = await service.from("control_organizations")
        .select("id,name,created_at,control_entitlements(station_limit,ends_at,suspended)")
        .order("created_at", { ascending: false }).limit(100);
      if (error) dbError(error);
      return json({ organizations: data });
    }
    if (method === "POST" && path.join("/") === "platform/organizations") {
      const input = await body(request);
      must(typeof input.name === "string" && input.name.trim().length >= 2 &&
        input.name.trim().length <= 160, 400, "CONTROL_INVALID_NAME");
      must(Number.isInteger(input.station_limit) && Number(input.station_limit) >= 1 &&
        Number(input.station_limit) <= 3, 400, "CONTROL_INVALID_STATION_LIMIT");
      const ends = date(input.ends_at);
      must(ends.getTime() > Date.now(), 400, "CONTROL_INVALID_DATE");
      const id = await rpc("control_create_organization", { p_actor: user.id,
        p_name: input.name.trim(), p_station_limit: input.station_limit,
        p_ends_at: ends.toISOString() });
      return json({ id }, 201);
    }
    if (path.length === 4 && path[1] === "organizations" && isUuid(path[2]) &&
        path[3] === "holders" && method === "GET") {
      const { data, error } = await service.from("control_memberships")
        .select("user_id,role,active,created_at").eq("organization_id", path[2])
        .eq("role", "holder").order("created_at");
      if (error) dbError(error);
      const members = await Promise.all((data ?? []).map(async (item) => {
        const { data: account, error: authError } = await service.auth.admin.getUserById(item.user_id);
        if (authError) throw new ApiError(503, "CONTROL_AUTH_UNAVAILABLE");
        return { ...item, email: account.user?.email ?? null,
          invitation_pending: !account.user?.last_sign_in_at };
      }));
      return json({ members });
    }
    if (path.length === 5 && path[1] === "organizations" && isUuid(path[2]) &&
        path[3] === "holders" && isUuid(path[4]) && method === "DELETE") {
      const { data: target, error } = await service.from("control_memberships")
        .select("organization_id,role").eq("user_id", path[4]).maybeSingle();
      if (error) dbError(error);
      must(target?.organization_id === path[2] && target.role === "holder",
        404, "CONTROL_MEMBER_NOT_FOUND");
      await rpc("control_revoke_member", { p_actor: user.id, p_user_id: path[4] });
      return json({ status: "revoked" });
    }
    if (path.length === 4 && path[1] === "organizations" && isUuid(path[2]) &&
        path[3] === "entitlement" && method === "PATCH") {
      const input = await body(request);
      must(Number.isInteger(input.station_limit) && Number(input.station_limit) >= 1 &&
        Number(input.station_limit) <= 3 && typeof input.suspended === "boolean",
      400, "CONTROL_INVALID_ENTITLEMENT");
      const ends = date(input.ends_at);
      await rpc("control_set_entitlement", { p_actor: user.id, p_organization_id: path[2],
        p_station_limit: input.station_limit, p_ends_at: ends.toISOString(),
        p_suspended: input.suspended });
      return json({ status: "updated" });
    }
    if (path.length === 4 && path[1] === "organizations" && isUuid(path[2]) &&
        path[3] === "holder-invite" && method === "POST") {
      const input = await body(request);
      return json(await invite(user.id, path[2], email(input.email), "holder"), 201);
    }
    if (path.length === 5 && path[1] === "organizations" && isUuid(path[2]) &&
        path[3] === "holder-restore" && isUuid(path[4]) && method === "POST") {
      const { data: target, error } = await service.from("control_memberships")
        .select("organization_id,role").eq("user_id", path[4]).maybeSingle();
      if (error) dbError(error);
      must(target?.organization_id === path[2] && target.role === "holder",
        404, "CONTROL_MEMBER_NOT_FOUND");
      await rpc("control_add_member", { p_actor: user.id,
        p_organization_id: path[2], p_user_id: path[4], p_role: "holder" });
      return json({ status: "restored" });
    }
  }

  if (method === "GET" && path.join("/") === "entitlement") {
    member(user);
    const { data, error } = await service.from("control_entitlements")
      .select("station_limit,ends_at,suspended,updated_at")
      .eq("organization_id", user.membership.organization_id).single();
    if (error) dbError(error);
    return json(data);
  }
  if (path[0] === "members") {
    holder(user);
    if (method === "GET" && path.length === 1) {
      const { data, error } = await service.from("control_memberships")
        .select("user_id,role,active,created_at")
        .eq("organization_id", user.membership.organization_id).order("created_at");
      if (error) dbError(error);
      const members = await Promise.all((data ?? []).map(async (item) => {
        const { data: account, error: authError } = await service.auth.admin.getUserById(item.user_id);
        if (authError) throw new ApiError(503, "CONTROL_AUTH_UNAVAILABLE");
        return { ...item, email: account.user?.email ?? null,
          invitation_pending: !account.user?.last_sign_in_at };
      }));
      return json({ members });
    }
    if (method === "POST" && path.join("/") === "members/invite") {
      const input = await body(request);
      return json(await invite(user.id, user.membership.organization_id,
        email(input.email), "operator"), 201);
    }
    if (method === "DELETE" && path.length === 2 && isUuid(path[1])) {
      await rpc("control_revoke_member", { p_actor: user.id, p_user_id: path[1] });
      return json({ status: "revoked" });
    }
    if (method === "POST" && path.length === 3 && isUuid(path[1]) && path[2] === "restore") {
      await rpc("control_add_member", { p_actor: user.id,
        p_organization_id: user.membership.organization_id,
        p_user_id: path[1], p_role: "operator" });
      return json({ status: "restored" });
    }
  }
  if (path[0] === "stations") {
    member(user);
    if (method === "GET" && path.length === 1) {
      holder(user);
      const { data, error } = await service.from("control_stations")
        .select("id,label,active,created_at,last_seen_at,app_version")
        .eq("organization_id", user.membership.organization_id).order("created_at");
      if (error) dbError(error);
      return json({ stations: data });
    }
    if (method === "POST" && path.length === 1) {
      holder(user);
      const input = await body(request);
      must(typeof input.label === "string" && input.label.trim().length >= 1 &&
        input.label.trim().length <= 80 && typeof input.public_key === "string" &&
        input.public_key.length === 43, 400, "CONTROL_INVALID_STATION");
      try {
        must(fromBase64url(input.public_key).length === 32, 400, "CONTROL_INVALID_STATION");
        await crypto.subtle.importKey("raw", arrayBuffer(fromBase64url(input.public_key)),
          "Ed25519", false, ["verify"]);
      } catch { throw new ApiError(400, "CONTROL_INVALID_STATION"); }
      const id = await rpc("control_activate_station", { p_actor: user.id,
        p_label: input.label.trim(), p_public_key: input.public_key });
      return json({ id }, 201);
    }
    if (path.length >= 2 && isUuid(path[1])) {
      const stationId = path[1];
      if (method === "DELETE" && path.length === 2) {
        holder(user);
        await rpc("control_deactivate_station", { p_actor: user.id, p_station_id: stationId });
        return json({ status: "deactivated" });
      }
      if (method === "POST" && path.length === 3 && path[2] === "challenges") {
        const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)));
        const nonceHash = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256",
          new TextEncoder().encode(nonce))));
        const challengeId = await rpc("control_create_challenge", { p_actor: user.id,
          p_station_id: stationId, p_nonce_hash: nonceHash });
        return json({ challenge_id: challengeId, nonce, expires_in_seconds: 120 }, 201);
      }
      if (method === "POST" && path.length === 3 && path[2] === "lease") {
        const input = await body(request);
        must(isUuid(input.challenge_id) && typeof input.nonce === "string" &&
          typeof input.signature === "string" && typeof input.app_version === "string" &&
          input.app_version.length <= 40, 400, "CONTROL_INVALID_LEASE_REQUEST");
        let signature: Uint8Array;
        try { signature = fromBase64url(input.signature); }
        catch { throw new ApiError(400, "CONTROL_INVALID_LEASE_REQUEST"); }
        must(signature.length === 64, 400, "CONTROL_INVALID_LEASE_REQUEST");
        const { data: station, error } = await service.from("control_stations")
          .select("public_key,organization_id,active").eq("id", stationId).maybeSingle();
        if (error) dbError(error);
        must(station?.active && station.organization_id === user.membership.organization_id,
          404, "CONTROL_STATION_NOT_FOUND");
        const publicKey = await crypto.subtle.importKey("raw",
          arrayBuffer(fromBase64url(station.public_key)), "Ed25519", false, ["verify"]);
        const valid = await crypto.subtle.verify("Ed25519", publicKey, arrayBuffer(signature),
          arrayBuffer(stationProofMessage(stationId, user.id, input.challenge_id, input.nonce)));
        must(valid, 403, "CONTROL_STATION_PROOF_INVALID");
        const nonceHash = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256",
          new TextEncoder().encode(input.nonce))));
        const rows = await rpc("control_consume_challenge", { p_actor: user.id,
          p_station_id: stationId, p_challenge_id: input.challenge_id,
          p_nonce_hash: nonceHash, p_app_version: input.app_version }) as
          { organization_id: string; role: string; ends_at: string }[];
        must(rows.length === 1 && rows[0].organization_id === user.membership.organization_id,
          403, "CONTROL_FORBIDDEN");
        return json(await leaseToken(user, stationId, rows[0].ends_at, rows[0].role));
      }
    }
  }
  throw new ApiError(404, "CONTROL_NOT_FOUND");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try { return await route(request); }
  catch (error) {
    if (error instanceof ApiError) return json({ detail: error.code }, error.status);
    console.error("control-v1 unexpected error", error instanceof Error ? error.name : "unknown");
    return json({ detail: "CONTROL_INTERNAL_ERROR" }, 500);
  }
});
