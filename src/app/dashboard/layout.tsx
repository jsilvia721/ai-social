import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Sidebar } from "@/components/dashboard/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/signin");
  }

  const memberships = await prisma.businessMember.findMany({
    where: { userId: session.user.id },
    include: { business: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  });

  const businesses = memberships.map((m) => m.business);

  return (
    <div className="min-h-screen bg-zinc-950">
      <Sidebar
        user={session.user}
        businesses={businesses}
        activeBusinessId={(session.user as { id: string; activeBusinessId?: string | null }).activeBusinessId}
      />
      <main className="ml-60 min-h-screen">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
