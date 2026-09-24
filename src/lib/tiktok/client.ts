/**
 * TikTok for Business (Marketing API) client.
 *
 * READ-ONLY by design. The workspace TikTok apps hold zero write permissions,
 * so this client holds zero write methods — no create, update, delete, upload
 * or status change. Do not add one.
 *
 * TikTok answers HTTP 200 for application errors and signals failure through
 * the envelope's `code` field. Every response therefore passes through
 * `unwrap`, which treats anything other than `code === 0` as an error. A bare
 * `res.ok` check (as in the Meta client) would turn every TikTok error into an
 * empty success.
 *
 * Tokens, app secrets and auth codes are never logged and never included in
 * error messages.
 */

export const TIKTOK_API_BASE_URL = "https://business-api.tiktok.com/open_api/v1.3";

// The Meta client sets no fetch timeout; TikTok calls get an explicit bound so
// a hung request cannot stall an OAuth callback indefinitely.
const REQUEST_TIMEOUT_MS = 30_000;

// Hard cap on pages followed for any paginated endpoint.
const MAX_PAGES = 20;

// TikTok is believed to cap `advertiser_ids` at 100 per /advertiser/info/
// request. That limit is not independently confirmed here, so 50 is a
// deliberately conservative batch size.
const ADVERTISER_INFO_BATCH_SIZE = 50;

// Code used for failures that never produced a TikTok envelope (network error,
// timeout, non-2xx status, unparseable body).
const TRANSPORT_FAILURE_CODE = -1;

// Code used when a paginated endpoint still has pages left after MAX_PAGES.
// Partial results are refused rather than returned.
const PAGINATION_LIMIT_CODE = -2;

export class TikTokApiError extends Error {
  readonly isTikTokApiError = true as const;
  constructor(
    message: string,
    readonly code: number,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "TikTokApiError";
  }
}

export interface TikTokAppCredentials {
  appId: string;
  appSecret: string;
}

export interface TikTokTokenExchangeResult {
  accessToken: string;
  // Raw numeric scope ids exactly as returned; null when absent.
  scopes: number[] | null;
  // Only set when TikTok actually returns `expires_in`. Never synthesized.
  expiresInSec: number | null;
}

export interface TikTokAuthorizedAdvertiser {
  advertiserId: string;
  advertiserName: string;
}

export interface TikTokAdvertiserInfo {
  advertiserId: string;
  name: string;
  currency: string;
  // Verbatim from TikTok. POSIX-style zones like "Etc/GMT-2" mean UTC+2 —
  // never normalize or reinterpret.
  timezone: string;
  status: string;
}

interface TikTokEnvelope<T> {
  code?: unknown;
  message?: unknown;
  request_id?: unknown;
  data?: T;
}

interface TikTokPageInfo {
  page?: number;
  page_size?: number;
  total_number?: number;
  total_page?: number;
}

interface TikTokListData<T> {
  list?: T[];
  page_info?: TikTokPageInfo;
}

// Internal only: an unwrapped envelope's data plus its request_id. Never
// returned from a public method.
interface TikTokUnwrapped<T> {
  data: T;
  requestId: string | null;
}

function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s) out = out.split(s).join("[REDACTED]");
  }
  return out;
}

export class TikTokClient {
  constructor(private readonly baseUrl: string = TIKTOK_API_BASE_URL) {}

  /**
   * Exchange an advertiser auth_code for a long-term access token.
   */
  async exchangeCodeForToken(
    authCode: string,
    creds: TikTokAppCredentials,
  ): Promise<TikTokTokenExchangeResult> {
    const data = await this.request<{
      access_token?: unknown;
      scope?: unknown;
      expires_in?: unknown;
    }>({
      method: "POST",
      path: "/oauth2/access_token/",
      label: "oauth2/access_token",
      body: {
        app_id: creds.appId,
        secret: creds.appSecret,
        auth_code: authCode,
        grant_type: "authorization_code",
      },
      secrets: [authCode, creds.appSecret],
    });

    if (typeof data?.access_token !== "string" || !data.access_token) {
      throw new TikTokApiError(
        "TikTok oauth2/access_token returned no access_token",
        TRANSPORT_FAILURE_CODE,
        null,
      );
    }

    const scopes =
      Array.isArray(data.scope) && data.scope.every((s) => typeof s === "number")
        ? (data.scope as number[])
        : null;
    const expiresInSec =
      typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
        ? data.expires_in
        : null;

    return { accessToken: data.access_token, scopes, expiresInSec };
  }

  /**
   * Advertisers that authorized this app for the given token.
   */
  async listAuthorizedAdvertisers(
    accessToken: string,
    appId: string,
    appSecret: string,
  ): Promise<TikTokAuthorizedAdvertiser[]> {
    const rows = await this.getAllPages<{
      advertiser_id?: unknown;
      advertiser_name?: unknown;
    }>({
      path: "/oauth2/advertiser/get/",
      label: "oauth2/advertiser/get",
      params: { app_id: appId, secret: appSecret },
      accessToken,
      secrets: [accessToken, appSecret],
    });

    return rows.map((r) => ({
      advertiserId: String(r.advertiser_id ?? ""),
      advertiserName: String(r.advertiser_name ?? ""),
    }));
  }

  /**
   * Basic info (name, currency, timezone, status) for the given advertisers.
   */
  async getAdvertiserInfo(
    accessToken: string,
    advertiserIds: string[],
  ): Promise<TikTokAdvertiserInfo[]> {
    if (advertiserIds.length === 0) return [];

    type Row = {
      advertiser_id?: unknown;
      name?: unknown;
      currency?: unknown;
      timezone?: unknown;
      status?: unknown;
    };

    // Batches run sequentially in input order; results concatenate in batch
    // order. No concurrency.
    const rows: Row[] = [];
    for (let i = 0; i < advertiserIds.length; i += ADVERTISER_INFO_BATCH_SIZE) {
      const batch = advertiserIds.slice(i, i + ADVERTISER_INFO_BATCH_SIZE);
      const batchRows = await this.getAllPages<Row>({
        path: "/advertiser/info/",
        label: "advertiser/info",
        params: {
          advertiser_ids: JSON.stringify(batch),
          fields: JSON.stringify([
            "advertiser_id",
            "name",
            "currency",
            "timezone",
            "status",
          ]),
        },
        accessToken,
        secrets: [accessToken],
      });
      rows.push(...batchRows);
    }

    return rows.map((r) => ({
      advertiserId: String(r.advertiser_id ?? ""),
      name: String(r.name ?? ""),
      currency: String(r.currency ?? ""),
      timezone: String(r.timezone ?? ""),
      status: String(r.status ?? ""),
    }));
  }

  /**
   * GET a list endpoint. When the response carries `page_info`, follow pages
   * until `page >= total_page`. If pages remain after MAX_PAGES, throws
   * TikTokApiError (PAGINATION_LIMIT_CODE) instead of returning partial rows.
   * `page_info` and `request_id` never leave this method.
   */
  private async getAllPages<T>(args: {
    path: string;
    label: string;
    params: Record<string, string>;
    accessToken: string;
    secrets: readonly string[];
  }): Promise<T[]> {
    const rows: T[] = [];
    let page = 1;
    let lastRequestId: string | null = null;

    for (let i = 0; i < MAX_PAGES; i++) {
      const params =
        i === 0 ? args.params : { ...args.params, page: String(page) };
      const { data, requestId } = await this.requestWithMeta<
        TikTokListData<T>
      >({
        method: "GET",
        path: args.path,
        label: args.label,
        params,
        accessToken: args.accessToken,
        secrets: args.secrets,
      });
      lastRequestId = requestId;

      rows.push(...(Array.isArray(data?.list) ? data.list : []));

      const info = data?.page_info;
      if (!info) return rows;
      const current = Number(info.page ?? page);
      const totalPage = Number(info.total_page ?? 0);
      if (!Number.isFinite(current) || current >= totalPage) return rows;
      page = current + 1;
    }

    throw new TikTokApiError(
      `TikTok ${args.label}: more pages remain after the ${MAX_PAGES}-page hard cap; refusing to return partial results`,
      PAGINATION_LIMIT_CODE,
      lastRequestId,
    );
  }

  private async request<T>(args: {
    method: "GET" | "POST";
    path: string;
    label: string;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    accessToken?: string;
    secrets: readonly string[];
  }): Promise<T> {
    return (await this.requestWithMeta<T>(args)).data;
  }

  private async requestWithMeta<T>(args: {
    method: "GET" | "POST";
    path: string;
    label: string;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    accessToken?: string;
    secrets: readonly string[];
  }): Promise<TikTokUnwrapped<T>> {
    const url = new URL(`${this.baseUrl}${args.path}`);
    for (const [k, v] of Object.entries(args.params ?? {})) {
      url.searchParams.set(k, v);
    }

    const headers: Record<string, string> = {};
    if (args.accessToken) headers["Access-Token"] = args.accessToken;
    if (args.body) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(url, {
        method: args.method,
        headers,
        body: args.body ? JSON.stringify(args.body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Only the error name / cause code — the original error may carry the
      // request URL, whose query string can hold the app secret.
      const e = err as { name?: string; cause?: { code?: string } };
      const reason = e?.cause?.code ?? e?.name ?? "unknown";
      throw new TikTokApiError(
        `TikTok ${args.label}: transport failure (${reason})`,
        TRANSPORT_FAILURE_CODE,
        null,
      );
    }

    return this.unwrap<T>(res, args.label, args.secrets);
  }

  /**
   * The single gate every TikTok response passes through. HTTP 200 alone is
   * never success — only an envelope with `code === 0` is.
   */
  private async unwrap<T>(
    res: Response,
    label: string,
    secrets: readonly string[],
  ): Promise<TikTokUnwrapped<T>> {
    const headerRequestId = res.headers.get("x-tt-logid");

    if (!res.ok) {
      throw new TikTokApiError(
        `TikTok ${label}: HTTP ${res.status}`,
        TRANSPORT_FAILURE_CODE,
        headerRequestId,
      );
    }

    let body: TikTokEnvelope<T>;
    try {
      body = (await res.json()) as TikTokEnvelope<T>;
    } catch {
      throw new TikTokApiError(
        `TikTok ${label}: response was not valid JSON`,
        TRANSPORT_FAILURE_CODE,
        headerRequestId,
      );
    }

    const requestId =
      typeof body?.request_id === "string" && body.request_id
        ? body.request_id
        : headerRequestId;

    if (body?.code !== 0) {
      const code =
        typeof body?.code === "number" ? body.code : TRANSPORT_FAILURE_CODE;
      const message =
        typeof body?.message === "string" ? body.message : "unknown error";
      throw new TikTokApiError(
        `TikTok ${label} error ${code}: ${redact(message, secrets)}`,
        code,
        requestId,
      );
    }

    return { data: body.data as T, requestId };
  }
}
