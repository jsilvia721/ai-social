import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { Building2, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function BusinessesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin");

  const memberships = await prisma.businessMember.findMany({
    where: { userId: session.user.id },
    include: {
      business: {
        include: {
          _count: { select: { socialAccounts: true, posts: true } },
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
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

      {memberships.length === 0 ? (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-6 py-12 text-center">
          <Building2 className="h-10 w-10 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-400 mb-4">No workspaces yet.</p>
          <Button asChild className="bg-violet-600 hover:bg-violet-700">
            <Link href="/dashboard/businesses/new">Create your first workspace</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {memberships.map(({ business, role }) => (
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
                  <span>{business._count.socialAccounts} accounts</span>
                  <span>{business._count.posts} posts</span>
                </div>
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
