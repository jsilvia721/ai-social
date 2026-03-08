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

  const isAdmin = session.user.isAdmin ?? false;

  let businesses: { id: string; name: string }[];
  if (isAdmin) {
    businesses = await prisma.business.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
  } else {
    const memberships = await prisma.businessMember.findMany({
      where: { userId: session.user.id },
      include: { business: { select: { id: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    });
    businesses = memberships.map((m) => m.business);
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <Sidebar
        user={session.user}
        businesses={businesses}
        activeBusinessId={session.user.activeBusinessId}
      />
      <main className="min-h-screen pt-14 md:pt-0 md:ml-60">
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
