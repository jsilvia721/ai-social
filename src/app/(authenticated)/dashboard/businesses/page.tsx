import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { Building2, Plus, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pluralize } from "@/lib/pluralize";

export default async function BusinessesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin");

  const isAdmin = session.user.isAdmin ?? false;

  let businessCards: {
    business: { id: string; name: string; contentStrategy: unknown; _count: { socialAccounts: number; posts: number } };
    role: string;
  }[];

  if (isAdmin) {
    const businesses = await prisma.business.findMany({
      include: {
        _count: { select: { socialAccounts: true, posts: true } },
        contentStrategy: true,
        members: {
          where: { userId: session.user.id },
          select: { role: true },
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    businessCards = businesses.map((b) => ({
      business: b,
      role: b.members[0]?.role ?? "ADMIN",
    }));
  } else {
    const memberships = await prisma.businessMember.findMany({
      where: { userId: session.user.id },
      include: {
        business: {
          include: {
            _count: { select: { socialAccounts: true, posts: true } },
            contentStrategy: true,
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });
    businessCards = memberships.map((m) => ({
      business: m.business,
      role: m.role,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Workspaces</h1>
          <p className="text-zinc-400 mt-1">Manage your client workspaces.</p>
        </div>
        <Button asChild className="bg-violet-600 hover:bg-violet-700">
          <Link href="/dashboard/businesses/new">
            <Plus className="h-4 w-4 mr-2" />
            New workspace
          </Link>
        </Button>
      </div>

      {businessCards.length === 0 ? (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-6 py-12 text-center">
          <Building2 className="h-10 w-10 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-400 mb-4">No workspaces yet.</p>
          <Button asChild className="bg-violet-600 hover:bg-violet-700">
            <Link href="/dashboard/businesses/new">Create your first workspace</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {businessCards.map(({ business, role }) => (
            <Card key={business.id} className="bg-zinc-800 border-zinc-700">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base text-zinc-100 truncate">
                    {business.name}
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className={
                      role === "OWNER"
                        ? "bg-violet-900/30 text-violet-400 border-violet-800 text-xs"
                        : "bg-zinc-900/30 text-zinc-400 border-zinc-700 text-xs"
                    }
                  >
                    {role === "OWNER" ? "Owner" : "Member"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-4 text-sm text-zinc-400">
                  <span>{pluralize(business._count.socialAccounts, "account")}</span>
                  <span>{pluralize(business._count.posts, "post")}</span>
                </div>
                {!business.contentStrategy && (
                  <Button
                    asChild
                    size="sm"
                    className="w-full bg-violet-700/30 hover:bg-violet-700/50 text-violet-300 border border-violet-800"
                    variant="outline"
                  >
                    <Link href={`/dashboard/businesses/${business.id}/onboard`}>
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      Complete Setup
                    </Link>
                  </Button>
                )}
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline" className="flex-1 border-zinc-600 text-zinc-300 hover:bg-zinc-700">
                    <Link href={`/dashboard/accounts`}>
                      <Users className="h-3.5 w-3.5 mr-1.5" />
                      Accounts
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="flex-1 border-zinc-600 text-zinc-300 hover:bg-zinc-700">
                    <Link href={`/dashboard/posts`}>
                      Posts
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
