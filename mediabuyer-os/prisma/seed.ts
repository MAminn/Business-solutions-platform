/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  PrismaClient,
  UserRole,
  ClientStatus,
  ClientHealth,
  AdPlatform,
  ConnectionStatus,
  CreativeType,
  AlertType,
  AlertSeverity,
  AlertStatus,
  TaskStatus,
  TaskPriority,
  TaskSource,
  InsightEntity,
} from "@prisma/client";
import { subDays, format } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱  Seeding database...");

  // Wipe in safe order
  await prisma.auditLog.deleteMany();
  await prisma.aiRun.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.reportComment.deleteMany();
  await prisma.report.deleteMany();
  await prisma.recommendation.deleteMany();
  await prisma.task.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.insightsDaily.deleteMany();
  await prisma.ad.deleteMany();
  await prisma.adSet.deleteMany();
  await prisma.creative.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.adAccountConnection.deleteMany();
  await prisma.clientAssignee.deleteMany();
  await prisma.client.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();

  // --- Identity --------------------------------------------------------
  const owner = await prisma.user.create({
    data: {
      email: "alex@mediabuyer.local",
      name: "Alex Carter",
      role: UserRole.OWNER,
      avatarUrl: null,
    },
  });

  const teammate = await prisma.user.create({
    data: {
      email: "sam@mediabuyer.local",
      name: "Sam Lee",
      role: UserRole.TEAM,
    },
  });

  const org = await prisma.organization.create({
    data: {
      name: "Mediabuyer Agency",
      slug: "mediabuyer-agency",
      members: {
        create: [
          { userId: owner.id, role: UserRole.OWNER },
          { userId: teammate.id, role: UserRole.TEAM },
        ],
      },
    },
  });

  // --- Clients (matches dashboard screenshot) --------------------------
  const clientsSeed = [
    {
      name: "Lumen Skincare",
      industry: "Beauty / DTC",
      health: ClientHealth.EXCELLENT,
      monthlyBudget: 85000,
      targetCpa: 28,
      targetRoas: 4.0,
      pacing: 73,
      roas: 4.2,
    },
    {
      name: "Northwind Apparel",
      industry: "Fashion",
      health: ClientHealth.GOOD,
      monthlyBudget: 120000,
      targetCpa: 35,
      targetRoas: 3.0,
      pacing: 82,
      roas: 3.1,
    },
    {
      name: "PeakFit Supplements",
      industry: "Health / Supplements",
      health: ClientHealth.NEEDS_ATTENTION,
      monthlyBudget: 60000,
      targetCpa: 40,
      targetRoas: 2.5,
      pacing: 86,
      roas: 2.4,
    },
    {
      name: "Harbor & Co Furniture",
      industry: "Home",
      health: ClientHealth.AT_RISK,
      monthlyBudget: 45000,
      targetCpa: 90,
      targetRoas: 2.0,
      pacing: 91,
      roas: 1.6,
    },
    {
      name: "Brightline SaaS",
      industry: "B2B SaaS",
      health: ClientHealth.EXCELLENT,
      monthlyBudget: 95000,
      targetCpa: 150,
      targetRoas: 5.0,
      pacing: 74,
      roas: 5.8,
    },
    {
      name: "Rove Travel Co",
      industry: "Travel",
      health: ClientHealth.GOOD,
      monthlyBudget: 70000,
      targetCpa: 65,
      targetRoas: 3.0,
      pacing: 48,
      roas: 3.4,
    },
  ];

  const createdClients = [];
  for (const c of clientsSeed) {
    const client = await prisma.client.create({
      data: {
        organizationId: org.id,
        name: c.name,
        industry: c.industry,
        status: ClientStatus.ACTIVE,
        health: c.health,
        monthlyBudget: c.monthlyBudget,
        targetCpa: c.targetCpa,
        targetRoas: c.targetRoas,
        assignees: {
          create: [{ userId: owner.id }],
        },
      },
    });

    // Ad account connection (mock, no real tokens)
    const connection = await prisma.adAccountConnection.create({
      data: {
        clientId: client.id,
        platform: AdPlatform.META,
        platformAccountId: `act_${Math.floor(Math.random() * 1e11)}`,
        accountName: `${c.name} Meta Ads`,
        currency: "USD",
        timezone: "America/New_York",
        status: ConnectionStatus.ACTIVE,
        lastSyncedAt: new Date(),
      },
    });

    createdClients.push({ client, connection, seedMeta: c });
  }

  // --- Campaigns & creatives (matches Performance + Creative screenshots) ---
  const campaignsSeed: Array<{
    clientName: string;
    name: string;
    spend: number;
    roas: number;
    cpa: number;
    ctr: number;
    hookRate: number;
    status: string;
  }> = [
    { clientName: "Lumen Skincare", name: "Spring Glow — Prospecting", spend: 18420, roas: 4.6, cpa: 22.4, ctr: 2.1, hookRate: 28.4, status: "ACTIVE" },
    { clientName: "Northwind Apparel", name: "Streetwear Launch V2", spend: 31200, roas: 3.4, cpa: 38.2, ctr: 1.9, hookRate: 24.1, status: "ACTIVE" },
    { clientName: "PeakFit Supplements", name: "Pre-Workout Hero", spend: 14800, roas: 2.1, cpa: 41.6, ctr: 1.4, hookRate: 17.2, status: "ACTIVE" },
    { clientName: "Harbor & Co Furniture", name: "Sofa Collection — Retarget", spend: 9200, roas: 1.4, cpa: 88, ctr: 0.9, hookRate: 12.8, status: "PAUSED" },
    { clientName: "Brightline SaaS", name: "Demo Request — Enterprise", spend: 22100, roas: 6.1, cpa: 142, ctr: 1.6, hookRate: 31, status: "ACTIVE" },
    { clientName: "Rove Travel Co", name: "Iceland Adventure Push", spend: 11400, roas: 3.8, cpa: 64, ctr: 2.3, hookRate: 26.7, status: "ACTIVE" },
    { clientName: "Lumen Skincare", name: "Branded Search", spend: 6800, roas: 8.2, cpa: 12, ctr: 4.1, hookRate: 0, status: "ACTIVE" },
    { clientName: "Northwind Apparel", name: "Holiday Bundles", spend: 0, roas: 0, cpa: 0, ctr: 0, hookRate: 0, status: "DRAFT" },
  ];

  for (const cs of campaignsSeed) {
    const ctx = createdClients.find((x) => x.client.name === cs.clientName);
    if (!ctx) continue;

    const campaign = await prisma.campaign.create({
      data: {
        adAccountConnectionId: ctx.connection.id,
        platformId: `cmp_${Math.floor(Math.random() * 1e11)}`,
        name: cs.name,
        objective: "OUTCOME_SALES",
        status: cs.status,
        effectiveStatus: cs.status,
        dailyBudget: 500,
      },
    });

    // Create one ad set + one ad per campaign for drilldown structure
    const adSet = await prisma.adSet.create({
      data: {
        campaignId: campaign.id,
        platformId: `as_${Math.floor(Math.random() * 1e11)}`,
        name: `${cs.name} — AdSet 1`,
        status: cs.status,
        effectiveStatus: cs.status,
        dailyBudget: 250,
        optimizationGoal: "OFFSITE_CONVERSIONS",
      },
    });

    await prisma.ad.create({
      data: {
        adSetId: adSet.id,
        platformId: `ad_${Math.floor(Math.random() * 1e11)}`,
        name: `${cs.name} — Ad 1`,
        status: cs.status,
        effectiveStatus: cs.status,
      },
    });

    // 30 days of insights for this campaign (matches chart)
    if (cs.spend > 0) {
      const dailySpend = cs.spend / 30;
      for (let i = 0; i < 30; i++) {
        const date = subDays(new Date(), 29 - i);
        const jitter = 0.85 + Math.random() * 0.3;
        const spendDay = dailySpend * jitter;
        const purchases = Math.round((spendDay * cs.roas) / 60);
        await prisma.insightsDaily.create({
          data: {
            entityType: InsightEntity.CAMPAIGN,
            entityId: campaign.id,
            date,
            spend: spendDay.toFixed(2),
            impressions: Math.round(spendDay * 280),
            reach: Math.round(spendDay * 180),
            clicks: Math.round(spendDay * 280 * (cs.ctr / 100)),
            ctr: (cs.ctr / 100).toFixed(4),
            cpc: spendDay > 0 ? (spendDay / Math.max(1, Math.round(spendDay * 280 * (cs.ctr / 100)))).toFixed(4) : "0",
            cpm: ((spendDay / Math.max(1, Math.round(spendDay * 280))) * 1000).toFixed(2),
            purchases,
            conversions: purchases,
            conversionValue: (spendDay * cs.roas).toFixed(2),
            roas: cs.roas.toFixed(4),
            cpa: purchases > 0 ? (spendDay / purchases).toFixed(2) : null,
            frequency: (1.5 + Math.random()).toFixed(2),
            hookRate: cs.hookRate > 0 ? (cs.hookRate / 100).toFixed(4) : null,
          },
        });
      }
    }
  }

  // --- Creatives (matches Creative Library screenshot) -------------------
  const creativesSeed: Array<{
    clientName: string;
    name: string;
    type: CreativeType;
    isWinner: boolean;
    gradient: string;
  }> = [
    { clientName: "Lumen Skincare", name: "Glow Routine UGC #4", type: CreativeType.VIDEO, isWinner: true, gradient: "from-purple-500 to-pink-500" },
    { clientName: "Lumen Skincare", name: "Before/After Carousel", type: CreativeType.CAROUSEL, isWinner: true, gradient: "from-cyan-400 to-blue-500" },
    { clientName: "Northwind Apparel", name: "Streetwear Drop Teaser", type: CreativeType.VIDEO, isWinner: false, gradient: "from-orange-400 to-red-500" },
    { clientName: "PeakFit Supplements", name: "PreWorkout Slam Cut", type: CreativeType.VIDEO, isWinner: false, gradient: "from-emerald-400 to-teal-500" },
    { clientName: "Harbor & Co Furniture", name: "Sofa Showroom Reel", type: CreativeType.VIDEO, isWinner: false, gradient: "from-violet-500 to-purple-500" },
    { clientName: "Brightline SaaS", name: "Demo Request Hero", type: CreativeType.IMAGE, isWinner: true, gradient: "from-pink-500 to-orange-500" },
    { clientName: "Rove Travel Co", name: "Iceland Drone Shots", type: CreativeType.VIDEO, isWinner: true, gradient: "from-violet-400 to-fuchsia-500" },
    { clientName: "Lumen Skincare", name: "Founder Story V2", type: CreativeType.VIDEO, isWinner: false, gradient: "from-sky-400 to-cyan-500" },
  ];

  for (const cs of creativesSeed) {
    const ctx = createdClients.find((x) => x.client.name === cs.clientName);
    if (!ctx) continue;
    await prisma.creative.create({
      data: {
        adAccountConnectionId: ctx.connection.id,
        platformId: `crv_${Math.floor(Math.random() * 1e11)}`,
        name: cs.name,
        type: cs.type,
        isWinner: cs.isWinner,
        // We store the Tailwind gradient as a placeholder thumbnail "url" for the UI seed
        thumbnailUrl: `gradient:${cs.gradient}`,
      },
    });
  }

  // --- Tasks (matches Ops kanban screenshot) -----------------------------
  const tasksSeed: Array<{
    clientName: string;
    title: string;
    priority: TaskPriority;
    status: TaskStatus;
    rule?: string;
    source: TaskSource;
  }> = [
    { clientName: "Harbor & Co Furniture", title: "Pause underperforming ad set: Sofa Retarget", priority: TaskPriority.HIGH, status: TaskStatus.TODO, rule: "ROAS < 1.5 for 3 days", source: TaskSource.RULE },
    { clientName: "Lumen Skincare", title: "Scale Glow Routine UGC #4 +30%", priority: TaskPriority.HIGH, status: TaskStatus.TODO, rule: "ROAS > 4 + Hook > 30%", source: TaskSource.RULE },
    { clientName: "Brightline SaaS", title: "Send weekly client report", priority: TaskPriority.LOW, status: TaskStatus.TODO, rule: "Every Monday 9am", source: TaskSource.MANUAL },
    { clientName: "Northwind Apparel", title: "Update budget pacing — over by 12%", priority: TaskPriority.HIGH, status: TaskStatus.TODO, rule: "Spend pacing > 110%", source: TaskSource.RULE },
    { clientName: "PeakFit Supplements", title: "Refresh creative — PreWorkout Slam Cut", priority: TaskPriority.MED, status: TaskStatus.IN_PROGRESS, rule: "Hook rate < 18%", source: TaskSource.RULE },
    { clientName: "Northwind Apparel", title: "Launch new copy angle test", priority: TaskPriority.MED, status: TaskStatus.IN_PROGRESS, rule: "Weekly cadence", source: TaskSource.MANUAL },
    { clientName: "Rove Travel Co", title: "Audit landing page conversion", priority: TaskPriority.MED, status: TaskStatus.DONE, rule: "CTR > 2% but CVR < 1.5%", source: TaskSource.RULE },
  ];

  for (const t of tasksSeed) {
    const ctx = createdClients.find((x) => x.client.name === t.clientName);
    if (!ctx) continue;
    await prisma.task.create({
      data: {
        clientId: ctx.client.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        rule: t.rule,
        source: t.source,
        createdById: owner.id,
        completedAt: t.status === TaskStatus.DONE ? new Date() : null,
      },
    });
  }

  // --- Alerts (matches Urgent tasks panel) -------------------------------
  const alertsSeed = [
    { clientName: "Harbor & Co Furniture", type: AlertType.ROAS_DROP, severity: AlertSeverity.CRITICAL, title: "ROAS dropped below 1.5 on Sofa Retarget", message: "ROAS < 1.5 for 3 consecutive days", rule: "ROAS < 1.5 for 3 days" },
    { clientName: "Lumen Skincare", type: AlertType.OTHER, severity: AlertSeverity.WARNING, title: "Scale opportunity: Glow Routine UGC #4", message: "ROAS > 4 and hook rate > 30%. Consider scaling +30%.", rule: "ROAS > 4 + Hook > 30%" },
    { clientName: "PeakFit Supplements", type: AlertType.CREATIVE_FATIGUE, severity: AlertSeverity.WARNING, title: "Hook rate drop on PreWorkout Slam Cut", message: "Hook rate fell below 18% over last 5 days.", rule: "Hook rate < 18%" },
    { clientName: "Northwind Apparel", type: AlertType.SPEND_PACING_OVER, severity: AlertSeverity.WARNING, title: "Spend pacing over by 12%", message: "Month-to-date spend is pacing over budget.", rule: "Spend pacing > 110%" },
  ];

  for (const a of alertsSeed) {
    const ctx = createdClients.find((x) => x.client.name === a.clientName);
    if (!ctx) continue;
    await prisma.alert.create({
      data: {
        clientId: ctx.client.id,
        type: a.type,
        severity: a.severity,
        title: a.title,
        message: a.message,
        rule: a.rule,
        status: AlertStatus.OPEN,
      },
    });
  }

  console.log("✅  Seed complete.");
  console.log("    Org:    ", org.name);
  console.log("    Owner:  ", owner.email);
  console.log("    Clients:", createdClients.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
