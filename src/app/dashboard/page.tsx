import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Clock, CheckCircle2, Link2, Heart, Eye } from "lucide-react";
import type { PostStatus, Platform } from "@/types";

interface RecentPost {
  id: string;
  content: string;
  status: string;
  socialAccount: { platform: Platform; username: string };
}

const STATUS_BADGE: Record<PostStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-zinc-700 text-zinc-300" },
  SCHEDULED: { label: "Scheduled", className: "bg-amber-900/50 text-amber-400 border-amber-800" },
  PUBLISHED: { label: "Published", className: "bg-emerald-900/50 text-emerald-400 border-emerald-800" },
  FAILED: { label: "Failed", className: "bg-red-900/50 text-red-400 border-red-800" },
};

const PLATFORM_COLOR: Record<string, string> = {
  TWITTER: "text-sky-400",
  INSTAGRAM: "text-pink-500",
  FACEBOOK: "text-blue-500",
};

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin");

  const userId = session.user.id;

  const [totalPosts, scheduledCount, publishedCount, connectedAccounts, recentPosts, totalLikesAgg, totalImpressionsAgg] =
    await Promise.all([
      prisma.post.count({ where: { userId } }),
      prisma.post.count({ where: { userId, status: "SCHEDULED" } }),
      prisma.post.count({ where: { userId, status: "PUBLISHED" } }),
      prisma.socialAccount.count({ where: { userId } }),
      prisma.post.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { socialAccount: { select: { platform: true, username: true } } },
      }),
      prisma.post.aggregate({ where: { userId, status: "PUBLISHED" }, _sum: { metricsLikes: true } }),
      prisma.post.aggregate({ where: { userId, status: "PUBLISHED" }, _sum: { metricsImpressions: true } }),
    ]);

  const stats = [
    { label: "Total Posts", value: totalPosts, icon: FileText, color: "text-zinc-400" },
    { label: "Scheduled", value: scheduledCount, icon: Clock, color: "text-amber-400" },
    { label: "Published", value: publishedCount, icon: CheckCircle2, color: "text-emerald-400" },
    { label: "Connected Accounts", value: connectedAccounts, icon: Link2, color: "text-violet-400" },
    { label: "Total Likes", value: totalLikesAgg._sum.metricsLikes ?? 0, icon: Heart, color: "text-pink-400" },
    { label: "Impressions", value: totalImpressionsAgg._sum.metricsImpressions ?? 0, icon: Eye, color: "text-sky-400" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Overview</h1>
        <p className="text-zinc-400 mt-1">Welcome back, {session.user.name?.split(" ")[0] ?? "there"}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-zinc-800 border-zinc-700">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">{label}</CardTitle>
              <Icon className={`h-4 w-4 ${color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-zinc-50">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent posts */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-4">Recent Posts</h2>
        {recentPosts.length === 0 ? (
          <Card className="bg-zinc-800 border-zinc-700">
            <CardContent className="py-12 text-center text-zinc-500">
              No posts yet. Create your first post to get started.
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-zinc-800 border-zinc-700">
            <div className="divide-y divide-zinc-700">
              {(recentPosts as RecentPost[]).map((post) => {
                const status = STATUS_BADGE[post.status as PostStatus];
                const platformColor = PLATFORM_COLOR[post.socialAccount.platform] ?? "text-zinc-400";
                return (
                  <div key={post.id} className="flex items-center gap-4 px-6 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{post.content}</p>
                      <p className={`text-xs mt-1 ${platformColor}`}>
                        @{post.socialAccount.username} · {post.socialAccount.platform}
                      </p>
                    </div>
                    <Badge variant="outline" className={`shrink-0 ${status.className}`}>
                      {status.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
