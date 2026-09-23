export type ControlRole = 'holder' | 'operator';

export interface ControlIdentity {
  user_id: string;
  organization_id: string | null;
  organization_name: string | null;
  role: ControlRole | null;
  platform_admin: boolean;
  mfa_required: boolean;
}

export interface Entitlement {
  station_limit: number;
  ends_at: string;
  suspended: boolean;
  updated_at: string;
}

export interface Member {
  user_id: string;
  email: string | null;
  role: ControlRole;
  active: boolean;
  invitation_pending: boolean;
  created_at: string;
}

export interface Station {
  id: string;
  label: string;
  active: boolean;
  created_at: string;
  last_seen_at: string | null;
  app_version: string | null;
}

export interface Organization {
  id: string;
  name: string;
  created_at: string;
  control_entitlements: Pick<Entitlement, 'station_limit' | 'ends_at' | 'suspended'> | null;
}

export interface StationChallenge {
  challenge_id: string;
  nonce: string;
  expires_in_seconds: number;
}

export interface LocalLease {
  token: string;
  new_work_until: number;
  finish_until: number;
}

export class ControlError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = 'ControlError';
  }
}

type TokenProvider = () => Promise<string | null>;

export class ControlClient {
  constructor(private readonly functionUrl: string,
              private readonly getToken: TokenProvider,
              private readonly publishableKey: string,
              private readonly fetcher: typeof fetch = fetch) {
    if (!/^https:\/\//.test(functionUrl)) throw new Error('CONTROL_HTTPS_REQUIRED');
    if (!publishableKey) throw new Error('CONTROL_PUBLISHABLE_KEY_REQUIRED');
  }

  private async request<T>(path: string, method = 'GET', payload?: object): Promise<T> {
    const token = await this.getToken();
    if (!token) throw new ControlError(401, 'CONTROL_AUTH_REQUIRED');
    const response = await this.fetcher(`${this.functionUrl.replace(/\/$/, '')}${path}`, {
      method, headers: {
        Authorization: `Bearer ${token}`,
        apikey: this.publishableKey,
        ...(payload ? {'Content-Type': 'application/json'} : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      cache: 'no-store', credentials: 'omit',
    });
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new ControlError(response.status, 'CONTROL_BAD_RESPONSE'); }
    if (!response.ok) {
      const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null;
      throw new ControlError(response.status,
        typeof detail === 'string' ? detail : 'CONTROL_REQUEST_FAILED');
    }
    return data as T;
  }

  me() { return this.request<ControlIdentity>('/me'); }
  entitlement() { return this.request<Entitlement>('/entitlement'); }
  members() { return this.request<{members: Member[]}>('/members'); }
  inviteOperator(email: string) {
    return this.request<{user_id: string; email: string; role: ControlRole}>(
      '/members/invite', 'POST', {email});
  }
  restoreOperator(userId: string) {
    return this.request<{status: string}>(`/members/${encodeURIComponent(userId)}/restore`, 'POST');
  }
  revokeOperator(userId: string) {
    return this.request<{status: string}>(`/members/${encodeURIComponent(userId)}`, 'DELETE');
  }
  stations() { return this.request<{stations: Station[]}>('/stations'); }
  activateStation(label: string, publicKey: string) {
    return this.request<{id: string}>('/stations', 'POST', {label, public_key: publicKey});
  }
  deactivateStation(stationId: string) {
    return this.request<{status: string}>(`/stations/${encodeURIComponent(stationId)}`, 'DELETE');
  }
  challenge(stationId: string) {
    return this.request<StationChallenge>(
      `/stations/${encodeURIComponent(stationId)}/challenges`, 'POST');
  }
  lease(stationId: string, challengeId: string, nonce: string,
        signature: string, appVersion: string) {
    return this.request<LocalLease>(`/stations/${encodeURIComponent(stationId)}/lease`,
      'POST', {challenge_id: challengeId, nonce, signature, app_version: appVersion});
  }
  organizations() {
    return this.request<{organizations: Organization[]}>(
      '/platform/organizations');
  }
  createOrganization(name: string, stationLimit: number, endsAt: string) {
    return this.request<{id: string}>('/platform/organizations', 'POST',
      {name, station_limit: stationLimit, ends_at: endsAt});
  }
  updateEntitlement(organizationId: string, stationLimit: number,
                    endsAt: string, suspended: boolean) {
    return this.request<{status: string}>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/entitlement`,
      'PATCH', {station_limit: stationLimit, ends_at: endsAt, suspended});
  }
  inviteHolder(organizationId: string, email: string) {
    return this.request<{user_id: string; email: string; role: ControlRole}>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/holder-invite`, 'POST', {email});
  }
  holders(organizationId: string) {
    return this.request<{members: Member[]}>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/holders`);
  }
  revokeHolder(organizationId: string, userId: string) {
    return this.request<{status: string}>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/holders/${encodeURIComponent(userId)}`,
      'DELETE');
  }
  restoreHolder(organizationId: string, userId: string) {
    return this.request<{status: string}>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/holder-restore/${encodeURIComponent(userId)}`,
      'POST');
  }
}
