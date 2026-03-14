import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { WeekPicker } from "@/components/insights/WeekPicker";
import { TopPerformerMeta } from "@/components/insights/TopPerformerMeta";
import { DigestPatternsSchema, DigestChangesSchema } from "@/lib/optimizer/schemas";
import type { Platform } from "@/types";
import { PLATFORM_STYLES } from "@/components/accounts/platform-utils";

const PLATFORM_COLOR: Record<Platform, string> = {
  TWITTER: "text-sky-400",
  INSTAGRAM: "text-pink-500",
  FACEBOOK: "text-blue-500",
  TIKTOK: "text-zinc-100",
  YOUTUBE: "text-red-500",
};

function formatWeekLabel(weekOf: Date): string {
  return `Week of ${weekOf.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function formatMixDelta(key: string, delta: number): string {
  const pct = Math.round(Math.abs(delta) * 100);
  const direction = delta > 0 ? "+" : "-";
  const label = key.charAt(0) + key.slice(1).toLowerCase();
  return `${direction}${pct}% ${label.toLowerCase()} posts`;
}

function formatCadenceDelta(platform: string, delta: number): string {
  const label = PLATFORM_STYLES[platform as Platform]?.label ?? platform.charAt(0) + platform.slice(1).toLowerCase();
  const direction = delta > 0 ? "+" : "";
  return `${direction}${delta} ${label} post${Math.abs(delta) !== 1 ? "s" : ""}/week`;
}

interface Props {
  searchParams: Promise<{ week?: string }>;
}

export default async function InsightsPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin");

  const { activeBusinessId, isAdmin } = session.user;
  const userId = session.user.id;

  if (!activeBusinessId) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Weekly Insights</h1>
          <p className="text-zinc-400 mt-1">AI-powered performance analysis.</p>
        </div>
        <p className="text-zinc-500 text-sm">Select a workspace to view insights.</p>
      </div>
    );
  }

  // Membership check (admin bypass)
  if (!isAdmin) {
    const membership = await prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId: activeBusinessId, userId } },
    });
    if (!membership) {
      return (
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-50">Weekly Insights</h1>
            <p className="text-zinc-400 mt-1">AI-powered performance analysis.</p>
          </div>
          <p className="text-zinc-500 text-sm">You don&apos;t have access to this workspace.</p>
        </div>
      );
    }
  }

  // Fetch last 12 digests
  const digests = await prisma.strategyDigest.findMany({
    where: { businessId: activeBusinessId },
    orderBy: { weekOf: "desc" },
    take: 12,
  });

  if (digests.length === 0) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Weekly Insights</h1>
          <p className="text-zinc-400 mt-1">AI-powered performance analysis.</p>
        </div>
        <Card className="bg-zinc-800 border-zinc-700">
          <CardContent className="py-12 text-center">
            <TrendingUp className="h-8 w-8 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400 text-sm">
              Your first weekly insight will appear after the optimizer runs.
            </p>
            <p className="text-zinc-500 text-xs mt-1">
              The optimizer needs at least 10 published posts with engagement data.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Determine selected week
  const params = await searchParams;
  const selectedWeekStr = params.week;
  const selectedDigest = selectedWeekStr
    ? digests.find((d) => d.weekOf.toISOString().slice(0, 10) === selectedWeekStr) ?? digests[0]
    : digests[0];

  // Parse JSON fields
  const patternsParsed = DigestPatternsSchema.safeParse(selectedDigest.patterns);
  const changesParsed = DigestChangesSchema.safeParse(selectedDigest.changes);

  const patterns = patternsParsed.success ? patternsParsed.data : { topPerformers: [], insights: [] };
  const changes = changesParsed.success ? changesParsed.data : {};

  // Resolve top performer post IDs
  const postIds = patterns.topPerformers.map((tp) => tp.postId);
  const posts = postIds.length > 0
    ? await prisma.post.findMany({
        where: { id: { in: postIds } },
        include: { socialAccount: { select: { platform: true, username: true } } },
      })
    : [];
  const postsById = new Map(posts.map((p) => [p.id, p]));

  // Week picker data
  const weeks = digests.map((d) => ({
    weekOf: d.weekOf.toISOString().slice(0, 10),
    label: formatWeekLabel(d.weekOf),
  }));

  // Strategy adjustments
  const formatMixEntries = Object.entries(changes.formatMix ?? {}).filter(([, v]) => v !== 0);
  const cadenceEntries = Object.entries(changes.cadence ?? {}).filter(([, v]) => v !== 0);
  const topicInsights = changes.topicInsights ?? [];
  const hasAdjustments = formatMixEntries.length > 0 || cadenceEntries.length > 0 || topicInsights.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Weekly Insights</h1>
          <p className="text-zinc-400 mt-1">AI-powered performance analysis.</p>
        </div>
        <WeekPicker
          weeks={weeks}
          selected={selectedDigest.weekOf.toISOString().slice(0, 10)}
        />
      </div>

      {/* Summary */}
      <Card className="bg-zinc-800 border-zinc-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-zinc-400">Performance Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-zinc-200 text-sm leading-relaxed whitespace-pre-line">
            {selectedDigest.summary}
          </p>
        </CardContent>
      </Card>

      {/* Top Performers */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-4">Top Performers</h2>
        {patterns.topPerformers.length === 0 ? (
          <p className="text-zinc-500 text-sm">No top performers identified this week.</p>
        ) : (
          <Card className="bg-zinc-800 border-zinc-700">
            <div className="divide-y divide-zinc-700">
              {patterns.topPerformers.map((tp) => {
                const post = postsById.get(tp.postId);
                if (!post) return null; // skip deleted posts
                return (
                  <div
                    key={tp.postId}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6 sm:py-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{post.content}</p>
                      <TopPerformerMeta
                        username={post.socialAccount.username}
                        platformColorClass={PLATFORM_COLOR[post.socialAccount.platform as Platform]}
                        topicPillar={tp.topicPillar}
                      />
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                        <TrendingUp className="h-3 w-3" />
                        {tp.score.toFixed(1)}x
                      </span>
                      {tp.format && (
                        <span className="text-xs text-zinc-500">
                          {tp.format.charAt(0) + tp.format.slice(1).toLowerCase()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {/* Key Insights */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-4">Key Insights</h2>
        {patterns.insights.length === 0 ? (
          <p className="text-zinc-500 text-sm">No insights this week.</p>
        ) : (
          <Card className="bg-zinc-800 border-zinc-700">
            <CardContent className="pt-4">
              <ul className="space-y-2.5">
                {patterns.insights.map((insight, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-300">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                    {insight}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Strategy Adjustments */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-4">Strategy Adjustments</h2>
        {!hasAdjustments ? (
          <p className="text-zinc-500 text-sm">
            No strategy adjustments this week — current strategy is performing well.
          </p>
        ) : (
          <Card className="bg-zinc-800 border-zinc-700">
            <CardContent className="pt-4 space-y-4">
              {formatMixEntries.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Content Mix
                  </p>
                  <div className="space-y-1.5">
                    {formatMixEntries.map(([key, delta]) => (
                      <p key={key} className="text-sm text-zinc-300">
                        <span className={delta > 0 ? "text-emerald-400" : "text-amber-400"}>
                          {formatMixDelta(key, delta)}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {cadenceEntries.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Posting Cadence
                  </p>
                  <div className="space-y-1.5">
                    {cadenceEntries.map(([platform, delta]) => (
                      <p key={platform} className="text-sm text-zinc-300">
                        <span className={delta > 0 ? "text-emerald-400" : "text-amber-400"}>
                          {formatCadenceDelta(platform, delta)}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {topicInsights.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Topic Insights
                  </p>
                  <ul className="space-y-1.5">
                    {topicInsights.map((insight, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-300">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
