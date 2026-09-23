export const DAY_SECONDS = 24 * 60 * 60;
export const OFFLINE_SECONDS = 7 * DAY_SECONDS;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function base64url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_BASE64URL");
  const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export function stationProofMessage(stationId: string, userId: string,
                                    challengeId: string, nonce: string): Uint8Array {
  return new TextEncoder().encode(
    `e-notario/station-lease/v1\n${stationId}\n${userId}\n${challengeId}\n${nonce}`);
}

export function leaseWindow(nowSeconds: number, entitlementEndSeconds: number) {
  if (!Number.isFinite(nowSeconds) || !Number.isFinite(entitlementEndSeconds)) {
    throw new Error("INVALID_LEASE_TIME");
  }
  const newWorkUntil = Math.min(nowSeconds + OFFLINE_SECONDS, entitlementEndSeconds);
  const finishUntil = newWorkUntil + DAY_SECONDS;
  if (finishUntil <= nowSeconds) throw new Error("ENTITLEMENT_INACTIVE");
  return { newWorkUntil, finishUntil };
}
