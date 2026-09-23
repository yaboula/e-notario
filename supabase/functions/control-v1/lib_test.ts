import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.18";
import { base64url, fromBase64url, leaseWindow, stationProofMessage } from "./lib.ts";

Deno.test("lease stops new work at entitlement expiry and allows 24h to finish", () => {
  const lease = leaseWindow(1_000, 2_000);
  assertEquals(lease, { newWorkUntil: 2_000, finishUntil: 88_400 });
  assertThrows(() => leaseWindow(88_400, 2_000), Error, "ENTITLEMENT_INACTIVE");
});

Deno.test("seven-day offline cap applies to a longer subscription", () => {
  const lease = leaseWindow(1_000, 1_000 + 60 * 86_400);
  assertEquals(lease.newWorkUntil, 1_000 + 7 * 86_400);
  assertEquals(lease.finishUntil, 1_000 + 8 * 86_400);
});

Deno.test("station proof has stable bytes shared with the Windows verifier", () => {
  const nonce = base64url(new Uint8Array(32).fill(110));
  assertEquals(fromBase64url(nonce).length, 32);
  assertEquals(new TextDecoder().decode(stationProofMessage("station", "user", "challenge", nonce)),
    `e-notario/station-lease/v1\nstation\nuser\nchallenge\n${nonce}`);
});
