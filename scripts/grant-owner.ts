/**
 * grant-owner.ts
 *
 * One-time, idempotent production data fix for the controlled pilot user.
 * Grants OWNER role to the pilot user within the existing "mediabuyer-agency"
 * organization. Safe to run multiple times.
 *
 * Usage:
 *   PILOT_EMAIL="pilot@example.com" tsx scripts/grant-owner.ts
 */
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

const ORG_SLUG = "mediabuyer-agency";

async function main() {
  const pilotEmail = process.env.PILOT_EMAIL?.trim();
  if (!pilotEmail) {
    throw new Error(
      "PILOT_EMAIL environment variable is required but was not set.",
    );
  }

  // 2. Find existing organization. Do not create.
  const organization = await prisma.organization.findUnique({
    where: { slug: ORG_SLUG },
  });
  if (!organization) {
    throw new Error(
      `Organization with slug "${ORG_SLUG}" was not found. Aborting — this script does not create organizations.`,
    );
  }

  // 4. Find user by email. Do not create.
  const user = await prisma.user.findUnique({
    where: { email: pilotEmail },
  });
  if (!user) {
    throw new Error(
      `User with email "${pilotEmail}" was not found. Aborting — this script does not create users.`,
    );
  }

  // 6. Upsert membership linking user to org with role OWNER.
  const membership = await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: UserRole.OWNER,
    },
    update: {
      role: UserRole.OWNER,
    },
  });

  // 7. Ensure User.role is OWNER.
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { role: UserRole.OWNER },
  });

  // 8. Verification output.
  console.log("✅  OWNER grant complete. Verification:");
  console.log(`    org id:                  ${organization.id}`);
  console.log(`    user id:                 ${updatedUser.id}`);
  console.log(`    user email:              ${updatedUser.email}`);
  console.log(`    User.role:               ${updatedUser.role}`);
  console.log(`    OrganizationMember.role: ${membership.role}`);
}

main()
  .catch((error) => {
    console.error("❌  grant-owner failed:");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
