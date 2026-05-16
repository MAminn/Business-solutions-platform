/**
 * Meta Marketing API client.
 *
 * Thin typed wrapper around the Graph API. Real syncing logic lives in
 * lib/meta/sync.ts. This file is intentionally minimal — flesh out as
 * you implement each sync type.
 */

import { META_GRAPH_URL } from "./oauth";

export interface MetaAdAccount {
  id: string;            // "act_xxxxx"
  name: string;
  account_id: string;    // numeric
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

export interface MetaAd {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  creative?: { id: string };
}

export interface MetaInsight {
  date_start: string;
  date_stop: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ action_type: string; value: string }>;
  video_play_actions?: Array<{ action_type: string; value: string }>;
  video_p25_watched_actions?: Array<{ value: string }>;
  video_p50_watched_actions?: Array<{ value: string }>;
  video_p75_watched_actions?: Array<{ value: string }>;
  video_p100_watched_actions?: Array<{ value: string }>;
}

export class MetaClient {
  constructor(private readonly accessToken: string) {}

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${META_GRAPH_URL}${path}`);
    url.searchParams.set("access_token", this.accessToken);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API ${res.status} on ${path}: ${body}`);
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
    const data = await this.get<{ data: MetaCampaign[] }>(`/${adAccountId}/campaigns`, {
      fields:
        "id,name,objective,status,effective_status,daily_budget,lifetime_budget,buying_type,start_time,stop_time,special_ad_categories",
      limit: "200",
    });
    return data.data;
  }

  async listAdSets(campaignId: string): Promise<MetaAdSet[]> {
    const data = await this.get<{ data: MetaAdSet[] }>(`/${campaignId}/adsets`, {
      fields:
        "id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,start_time,end_time",
      limit: "200",
    });
    return data.data;
  }

  async listAds(adSetId: string): Promise<MetaAd[]> {
    const data = await this.get<{ data: MetaAd[] }>(`/${adSetId}/ads`, {
      fields: "id,name,status,effective_status,creative{id}",
      limit: "200",
    });
    return data.data;
  }

  async getInsightsDaily(
    entityId: string,
    sinceDate: string,
    untilDate: string
  ): Promise<MetaInsight[]> {
    const data = await this.get<{ data: MetaInsight[] }>(`/${entityId}/insights`, {
      time_increment: "1",
      time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
      fields:
        "impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,actions,action_values,purchase_roas,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions",
      action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]),
      limit: "500",
    });
    return data.data;
  }
}
