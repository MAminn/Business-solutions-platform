import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import type { UserRole } from "@prisma/client";

function roleLabel(role: UserRole): string {
  switch (role) {
    case "OWNER":
      return "Senior Media Buyer";
    case "TEAM":
      return "Media Buyer";
    case "CLIENT":
      return "Client";
    case "VIEWER":
      return "Viewer";
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={{ name: user.name ?? "User", role: roleLabel(user.role) }} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
