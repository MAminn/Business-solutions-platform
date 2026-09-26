import { TikTokApiError, TikTokClient } from "@/lib/tiktok/client";

/**
 * TikTok connection token health — check and classify only.
 *
 * One read-only /advertiser/info/ call for the connection's own advertiser.
 * No persistence, no status change, no refresh: callers decide what to do
 * with the result.
 *
 * Only empirically confirmed TikTok codes may mark a token invalid. Every
 * other TikTok code is UNKNOWN, and every failure that never produced a
 * TikTok envelope is TRANSIENT — a flaky network must never look like a
 * dead token.
 *
 * The access token is never logged, returned or embedded in a result.
 */

export type TikTokTokenHealthState =
  | "HEALTHY"
  | "TOKEN_INVALID"
  | "ADVERTISER_UNREACHABLE"
  | "TRANSIENT"
  | "UNKNOWN";

export interface TikTokTokenHealth {
  state: TikTokTokenHealthState;
  tiktokCode: number | null;
  requestId: string | null;
  checkedAt: Date;
}

// 40105 was observed from /advertiser/info/ for an invalid/revoked token
// during Phase 1c-1 validation. Do not add a code without equivalent evidence.
const TOKEN_INVALID_CODES = new Set<number>([40105]);

// Mirrors the client's code for failures that never produced a TikTok
// envelope (network error, timeout, non-2xx status, unparseable body).
const TRANSPORT_FAILURE_CODE = -1;

export function classifyTikTokHealthError(
  err: unknown,
): Omit<TikTokTokenHealth, "checkedAt"> {
  if (!(err instanceof TikTokApiError)) {
    return { state: "TRANSIENT", tiktokCode: null, requestId: null };
  }

  const tiktokCode = err.code;
  const requestId = err.requestId ?? null;

  if (tiktokCode === TRANSPORT_FAILURE_CODE) {
    return { state: "TRANSIENT", tiktokCode, requestId };
  }
  if (TOKEN_INVALID_CODES.has(tiktokCode)) {
    return { state: "TOKEN_INVALID", tiktokCode, requestId };
  }
  return { state: "UNKNOWN", tiktokCode, requestId };
}

/**
 * Never throws: every path resolves to a TikTokTokenHealth.
 */
export async function checkTikTokConnectionHealth(input: {
  accessToken: string;
  advertiserId: string;
}): Promise<TikTokTokenHealth> {
  const checkedAt = new Date();

  try {
    const requested = String(input.advertiserId);
    const infos = await new TikTokClient().getAdvertiserInfo(
      input.accessToken,
      [requested],
    );

    // An empty id never counts as present: the client maps a missing
    // advertiser_id to "".
    const present =
      requested !== "" &&
      infos.some((info) => String(info.advertiserId) === requested);

    // getAdvertiserInfo does not expose request_id on success.
    return {
      state: present ? "HEALTHY" : "ADVERTISER_UNREACHABLE",
      tiktokCode: 0,
      requestId: null,
      checkedAt,
    };
  } catch (err) {
    try {
      return { ...classifyTikTokHealthError(err), checkedAt };
    } catch {
      return { state: "TRANSIENT", tiktokCode: null, requestId: null, checkedAt };
    }
  }
}
