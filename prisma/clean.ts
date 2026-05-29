import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log("🧹  Cleaning database (keeping schema + migrations)...");

  // Delete all rows in reverse dependency order. Mirror the wipe
  // order from prisma/seed.ts so we don't fight foreign keys.
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
  await prisma.strategyObjective.deleteMany();
  await prisma.strategy.deleteMany();
  await prisma.adAccountConnection.deleteMany();
  await prisma.clientAssignee.deleteMany();
  await prisma.client.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();

  // Create the minimum identity required by requireUser() in
  // dev-bypass mode: one OWNER user + one organization + one
  // membership row linking them.
  const owner = await prisma.user.create({
    data: {
      email: "owner@mediabuyer.local",
      name: "Workspace Owner",
      role: UserRole.OWNER,
      avatarUrl: null,
    },
  });

  await prisma.organization.create({
    data: {
      name: "My Agency",
      slug: "my-agency",
      members: {
        create: [{ userId: owner.id, role: UserRole.OWNER }],
      },
    },
  });

  console.log("✅  Database is clean.");
  console.log("    Owner email :", owner.email);
  console.log("    Clients     : 0");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Start dev server: npm run dev");
  console.log("  2. Open /clients/new in your browser");
  console.log(
    "  3. Fill the Add Client form with REAL Meta ad-account details",
  );
  console.log("  4. Go to /settings/integrations and click Connect");
  console.log("  5. After OAuth, click Initial sync (30d)");
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
