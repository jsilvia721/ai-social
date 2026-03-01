import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Heart, MessageCircle, Repeat2, Eye, TrendingUp, Bookmark } from "lucide-react";
import type { Platform } from "@/types";

const PLATFORM_COLOR: Record<Platform, string> = {
  TWITTER: "text-sky-400",
  INSTAGRAM: "text-pink-500",
  FACEBOOK: "text-blue-500",
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin");

  const userId = session.user.id;

  const posts = await prisma.post.findMany({
    where: { userId, status: "PUBLISHED" },
    include: { socialAccount: { select: { platform: true, username: true } } },
    orderBy: { publishedAt: "desc" },
  });

  // Aggregate totals
  const totals = posts.reduce(
    (acc, p) => ({
      likes: acc.likes + (p.metricsLikes ?? 0),
      comments: acc.comments + (p.metricsComments ?? 0),
      shares: acc.shares + (p.metricsShares ?? 0),
      impressions: acc.impressions + (p.metricsImpressions ?? 0),
      reach: acc.reach + (p.metricsReach ?? 0),
      saves: acc.saves + (p.metricsSaves ?? 0),
    }),
    { likes: 0, comments: 0, shares: 0, impressions: 0, reach: 0, saves: 0 }
  );

  const summaryStats = [
    { label: "Total Likes", value: totals.likes, icon: Heart, color: "text-pink-400" },
    { label: "Comments", value: totals.comments, icon: MessageCircle, color: "text-violet-400" },
    { label: "Shares / Retweets", value: totals.shares, icon: Repeat2, color: "text-amber-400" },
    { label: "Impressions", value: totals.impressions, icon: Eye, color: "text-sky-400" },
    { label: "Reach", value: totals.reach, icon: TrendingUp, color: "text-emerald-400" },
    { label: "Saves", value: totals.saves, icon: Bookmark, color: "text-rose-400" },
  ];

  // Per-platform breakdown
  const byPlatform = posts.reduce<
    Record<string, { count: number; likes: number; impressions: number; comments: number; platform: Platform }>
  >((acc, p) => {
    const key = p.socialAccount.platform;
    if (!acc[key]) acc[key] = { count: 0, likes: 0, impressions: 0, comments: 0, platform: key as Platform };
    acc[key].count++;
    acc[key].likes += p.metricsLikes ?? 0;
    acc[key].impressions += p.metricsImpressions ?? 0;
    acc[key].comments += p.metricsComments ?? 0;
    return acc;
  }, {});

  // Top 10 posts by likes
  const topPosts = [...posts]
    .sort((a, b) => (b.metricsLikes ?? 0) - (a.metricsLikes ?? 0))
    .slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Analytics</h1>
        <p className="text-zinc-400 mt-1">Engagement metrics across all published posts.</p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {summaryStats.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-zinc-800 border-zinc-700">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-zinc-400">{label}</CardTitle>
              <Icon className={`h-4 w-4 ${color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-zinc-50">{fmt(value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-platform breakdown */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-4">By Platform</h2>
        {Object.keys(byPlatform).length === 0 ? (
          <p className="text-zinc-500 text-sm">No platform data yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Object.values(byPlatform).map(({ platform, count, likes, impressions, comments }) => (
              <Card key={platform} className="bg-zinc-800 border-zinc-700">
                <CardHeader className="pb-2">
                  <CardTitle className={`text-sm font-semibold ${PLATFORM_COLOR[platform]}`}>
                    {platform.charAt(0) + platform.slice(1).toLowerCase()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-zinc-400">
                  <p><span className="text-zinc-200 font-medium">{count}</span> published posts</p>
                  <p><span className="text-zinc-200 font-medium">{fmt(likes)}</span> likes</p>
                  <p><span className="text-zinc-200 font-medium">{fmt(impressions)}</span> impressions</p>
                  <p><span className="text-zinc-200 font-medium">{fmt(comments)}</span> comments</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Top posts by likes */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-4">Top Posts by Likes</h2>
        {topPosts.length === 0 ? (
          <p className="text-zinc-500 text-sm">No published posts yet.</p>
        ) : (
          <Card className="bg-zinc-800 border-zinc-700">
            <div className="divide-y divide-zinc-700">
              {topPosts.map((post) => (
                <div key={post.id} className="flex items-center gap-4 px-6 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200 truncate">{post.content}</p>
                    <p className={`text-xs mt-1 ${PLATFORM_COLOR[post.socialAccount.platform as Platform]}`}>
                      @{post.socialAccount.username}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-xs text-zinc-400">
                    <span className="flex items-center gap-1">
                      <Heart className="h-3.5 w-3.5 text-pink-400" />
                      {fmt(post.metricsLikes ?? 0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5 text-sky-400" />
                      {fmt(post.metricsImpressions ?? 0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5 text-violet-400" />
                      {fmt(post.metricsComments ?? 0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
