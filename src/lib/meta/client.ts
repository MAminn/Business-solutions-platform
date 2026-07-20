/**
 * Meta Marketing API client.
 *
 * Thin typed wrapper around the Graph API. Real syncing logic lives in
 * lib/meta/sync.ts. This file is intentionally minimal — flesh out as
 * you implement each sync type.
 */

import { META_GRAPH_URL } from "./oauth";

export class MetaRateLimitError extends Error {
  readonly isMetaRateLimit = true as const;
  constructor(
    public readonly endpoint: string,
    public readonly metaCode: number,
    public readonly metaSubcode: number | undefined,
    public readonly userTitle: string | undefined,
    public readonly userMsg: string | undefined,
  ) {
    super(
      `Meta rate limit reached on ${endpoint} (code ${metaCode}` +
        (metaSubcode ? `/${metaSubcode}` : "") +
        `): ${userMsg ?? userTitle ?? "too many calls"}`,
    );
    this.name = "MetaRateLimitError";
  }
}

export class MetaApiError extends Error {
  readonly isMetaApiError = true as const;
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    public readonly metaCode: number | undefined,
    public readonly metaSubcode: number | undefined,
    public readonly body: string,
  ) {
    super(`Meta API ${status} on ${endpoint}: ${body}`);
    this.name = "MetaApiError";
  }
}

interface MetaErrorEnvelope {
  error?: {
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    message?: string;
  };
}

function isMetaErrorEnvelope(value: unknown): value is MetaErrorEnvelope {
  return typeof value === "object" && value !== null && "error" in value;
}

export interface MetaAdAccount {
  id: string; // "act_xxxxx"
  name: string;
  account_id: string; // numeric
  currency: string;
  timezone_name: string;
  account_status: number;
}

export interface MetaCampaign {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  buying_type?: string;
  start_time?: string;
  stop_time?: string;
  special_ad_categories?: string[];
}

export interface MetaAdSet {
  id: string;
  name: string;
  // Present when adsets are listed at the account level (used to map a row
  // back to its parent campaign).
  campaign_id?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  start_time?: string;
  end_time?: string;
}

export interface MetaCreative {
  id: string;
  name?: string;
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  body?: string;
  title?: string;
  call_to_action_type?: string;
  object_type?: string;
  object_story_id?: string;
  effective_object_story_id?: string;
  image_hash?: string;
}

/**
 * A row from the `/act_{id}/adimages` edge. `permalink_url` is a stable,
 * non-expiring source for the full-resolution image; `url` is the (often
 * shorter-lived) CDN URL. Used by creative-asset ingestion to pick the best
 * download source for a given image hash.
 */
export interface MetaAdImage {
  hash?: string;
  permalink_url?: string;
  url?: string;
  width?: number;
  height?: number;
}

export interface MetaAd {
  id: string;
  name: string;
  // Present when ads are listed at the account level (used to map a row back
  // to its parent adset / campaign).
  adset_id?: string;
  campaign_id?: string;
  status?: string;
  effective_status?: string;
  creative?: MetaCreative;
}

export interface MetaInsight {
  date_start: string;
  date_stop: string;
  // Present when insights are pulled at the account level with a `level`
  // breakdown (level=campaign / level=ad). Used to map rows back to local
  // records via their platformId.
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  // Note: when conversions are entirely view/click-window attributed (common
  // on new accounts), Meta omits the top-level `value` and only returns the
  // attribution-window fields (`7d_click` / `1d_view`).
  actions?: Array<{
    action_type: string;
    value?: string;
    "1d_view"?: string;
    "7d_click"?: string;
  }>;
  action_values?: Array<{
    action_type: string;
    value?: string;
    "1d_view"?: string;
    "7d_click"?: string;
  }>;
  purchase_roas?: Array<{
    action_type: string;
    value?: string;
    "1d_view"?: string;
    "7d_click"?: string;
  }>;
  video_play_actions?: Array<{
    action_type: string;
    value?: string;
    "1d_view"?: string;
    "7d_click"?: string;
  }>;
  video_p25_watched_actions?: Array<{
    value?: string;
    "1d_view"?: string;
    "7d_click"?: string;
  }>;
  video_p50_watched_actions?: Array<{
    value?: string;
    "1d_view"?: string;
    "7d_click"?: string;
  }>;
  video_p75_watched_actions?: Array<{
    value?: string;
    "1d_view"?: string;
    "7d_click"?: string;
  }>;
  video_p100_watched_actions?: Array<{
    value?: string;
    "1d_view"?: string;
    "7d_click"?: string;
  }>;
}

// Shared insights field list, used for both per-entity and account-level pulls
// so the persisted shape stays identical regardless of fetch strategy.
const INSIGHTS_FIELDS =
  "impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,actions,action_values,purchase_roas,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions";

export class MetaClient {
  private readonly graphUrl: string;

  constructor(
    private readonly accessToken: string,
    apiVersion?: string,
  ) {
    this.graphUrl = apiVersion
      ? `https://graph.facebook.com/${apiVersion}`
      : META_GRAPH_URL;
  }

  private async get<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(`${this.graphUrl}${path}`);
    url.searchParams.set("access_token", this.accessToken);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return this.request<T>(url.toString(), path);
  }

  /**
   * Fetch an absolute URL (e.g. a Meta `paging.next` cursor link, which
   * already carries the access token and all query params) while keeping
   * the same spacing and error handling as `get`.
   */
  private async getAbsolute<T>(absoluteUrl: string, label: string): Promise<T> {
    return this.request<T>(absoluteUrl, label);
  }

  /**
   * Fetch every page of a paginated edge by following Meta's `paging.next`
   * cursor URLs until exhausted. The same guard bound used by
   * `getAccountInsightsByLevel` protects against a pathological cursor.
   */
  private async getAllPages<T>(
    path: string,
    params: Record<string, string>,
    label: string,
  ): Promise<T[]> {
    const rows: T[] = [];
    let page = await this.get<{ data: T[]; paging?: { next?: string } }>(
      path,
      params,
    );
    rows.push(...page.data);

    let next = page.paging?.next;
    let guard = 0;
    while (next && guard < 1000) {
      guard++;
      page = await this.getAbsolute<{ data: T[]; paging?: { next?: string } }>(
        next,
        `${label} (page ${guard + 1})`,
      );
      rows.push(...page.data);
      next = page.paging?.next;
    }

    return rows;
  }

  private async request<T>(fullUrl: string, label: string): Promise<T> {
    console.log(`[meta] GET ${label}`);
    // Gentle inter-call spacing to remove burst pressure — not a real rate limiter.
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    const res = await fetch(fullUrl, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new MetaApiError(label, res.status, undefined, undefined, body);
      }

      const envelope = isMetaErrorEnvelope(parsed) ? parsed.error : undefined;
      const code = envelope?.code;
      const subcode = envelope?.error_subcode;
      const userTitle = envelope?.error_user_title;
      const userMsg = envelope?.error_user_msg;

      if (code === 17 || code === 80004 || subcode === 2446079) {
        throw new MetaRateLimitError(
          label,
          code ?? 17,
          subcode,
          userTitle,
          userMsg,
        );
      }
      throw new MetaApiError(label, res.status, code, subcode, body);
    }
    return res.json() as Promise<T>;
  }

  async listAdAccounts(): Promise<MetaAdAccount[]> {
    const data = await this.get<{ data: MetaAdAccount[] }>("/me/adaccounts", {
      fields: "id,name,account_id,currency,timezone_name,account_status",
      limit: "200",
    });
    return data.data;
  }

  async listCampaigns(adAccountId: string): Promise<MetaCampaign[]> {
    // Account-level edge — follow cursor pagination to completion so large
    // accounts return every campaign, not just the first page.
    return this.getAllPages<MetaCampaign>(
      `/${adAccountId}/campaigns`,
      {
        fields:
          "id,name,objective,status,effective_status,daily_budget,lifetime_budget,buying_type,start_time,stop_time,special_ad_categories",
        limit: "500",
      },
      `/${adAccountId}/campaigns`,
    );
  }

  async listAdSets(campaignId: string): Promise<MetaAdSet[]> {
    const data = await this.get<{ data: MetaAdSet[] }>(
      `/${campaignId}/adsets`,
      {
        fields:
          "id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,start_time,end_time",
        limit: "200",
      },
    );
    return data.data;
  }

  /**
   * All adsets for an ad account in one paginated call (replaces one
   * `/{campaign_id}/adsets` request per campaign, which trips Meta rate limit
   * code 17 / 2446079 on large accounts). Rows carry `campaign_id` so callers
   * can map each adset to its parent campaign.
   */
  async listAccountAdSets(adAccountId: string): Promise<MetaAdSet[]> {
    return this.getAllPages<MetaAdSet>(
      `/${adAccountId}/adsets`,
      {
        fields:
          "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,start_time,end_time",
        limit: "500",
      },
      `/${adAccountId}/adsets`,
    );
  }

  async listAds(adSetId: string): Promise<MetaAd[]> {
    const data = await this.get<{ data: MetaAd[] }>(`/${adSetId}/ads`, {
      fields:
        "id,name,status,effective_status,creative{id,name,thumbnail_url,image_url,video_id,body,title,call_to_action_type,object_type,object_story_id,effective_object_story_id,image_hash}",
      limit: "200",
    });
    return data.data;
  }

  /**
   * All ads for an ad account in one paginated call (replaces one
   * `/{adset_id}/ads` request per adset). Rows carry `adset_id` and
   * `campaign_id` for mapping, and the full nested `creative` block so the
   * Creatives tab keeps populating exactly as before.
   */
  async listAccountAds(adAccountId: string): Promise<MetaAd[]> {
    return this.getAllPages<MetaAd>(
      `/${adAccountId}/ads`,
      {
        fields:
          "id,name,adset_id,campaign_id,status,effective_status,creative{id,name,thumbnail_url,image_url,video_id,body,title,call_to_action_type,object_type,object_story_id,effective_object_story_id,image_hash}",
        limit: "100",
      },
      `/${adAccountId}/ads`,
    );
  }

  async getInsightsDaily(
    entityId: string,
    sinceDate: string,
    untilDate: string,
  ): Promise<MetaInsight[]> {
    const data = await this.get<{ data: MetaInsight[] }>(
      `/${entityId}/insights`,
      {
        time_increment: "1",
        time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
        fields: INSIGHTS_FIELDS,
        action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]),
        limit: "500",
      },
    );
    return data.data;
  }

  /**
   * Account-level insights with a `level` breakdown (campaign or ad).
   *
   * This replaces per-entity insight loops: instead of one Graph API call
   * per campaign/adset/ad (which trips Meta rate limit code 17 / 2446079 on
   * large accounts), we make a single paginated call per level for the whole
   * ad account. Every page of `paging.next` is followed until exhausted.
   *
   * Returned rows carry `campaign_id` (level=campaign) or `ad_id`/`adset_id`/
   * `campaign_id` (level=ad) so callers can map them to local records.
   */
  async getAccountInsightsByLevel(
    adAccountId: string,
    level: "campaign" | "ad",
    sinceDate: string,
    untilDate: string,
  ): Promise<MetaInsight[]> {
    const idFields =
      level === "campaign" ? "campaign_id" : "ad_id,adset_id,campaign_id";

    const rows: MetaInsight[] = [];
    let page = await this.get<{
      data: MetaInsight[];
      paging?: { next?: string };
    }>(`/${adAccountId}/insights`, {
      level,
      time_increment: "1",
      time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
      fields: `${idFields},${INSIGHTS_FIELDS}`,
      action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]),
      limit: "500",
    });
    rows.push(...page.data);

    // Follow Meta's cursor pagination until there is no `next` page. A guard
    // bounds the loop against a pathological/never-ending cursor.
    let next = page.paging?.next;
    let guard = 0;
    while (next && guard < 1000) {
      guard++;
      page = await this.getAbsolute<{
        data: MetaInsight[];
        paging?: { next?: string };
      }>(next, `/${adAccountId}/insights (level=${level} page ${guard + 1})`);
      rows.push(...page.data);
      next = page.paging?.next;
    }

    return rows;
  }

  /**
   * Resolve ad-image metadata (including a stable `permalink_url` source) for a
   * set of image hashes on an ad account. Read-only — used by creative-asset
   * ingestion to find the best source URL before downloading. Hashes are sent
   * in batches and every page of `paging.next` is followed via `getAllPages`,
   * reusing the same 150ms inter-call spacing and MetaRateLimitError handling
   * as every other edge.
   */
  async resolveAdImages(
    adAccountId: string,
    hashes: string[],
  ): Promise<MetaAdImage[]> {
    const unique = Array.from(
      new Set(hashes.filter((h) => typeof h === "string" && h.length > 0)),
    );
    if (unique.length === 0) return [];

    const BATCH = 50;
    const out: MetaAdImage[] = [];
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const rows = await this.getAllPages<MetaAdImage>(
        `/${adAccountId}/adimages`,
        {
          fields: "permalink_url,url,width,height,hash",
          hashes: JSON.stringify(batch),
          limit: "500",
        },
        `/${adAccountId}/adimages`,
      );
      out.push(...rows);
    }
    return out;
  }
}
