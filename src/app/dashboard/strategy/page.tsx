import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { StrategyClient } from "./strategy-client";

export const dynamic = "force-dynamic";

export default async function StrategyPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin");

  const activeBusinessId = session.user.activeBusinessId;
  if (!activeBusinessId) {
    return (
      <div className="text-center py-16 text-zinc-400">
        <p>Select a workspace to view strategy settings.</p>
      </div>
    );
  }

  const isAdmin = session.user.isAdmin ?? false;

  // Parallelize membership check and strategy fetch
  const [membership, strategy] = await Promise.all([
    isAdmin
      ? null
      : prisma.businessMember.findUnique({
          where: {
            businessId_userId: {
              businessId: activeBusinessId,
              userId: session.user.id,
            },
          },
        }),
    prisma.contentStrategy.findUnique({
      where: { businessId: activeBusinessId },
      select: {
        industry: true,
        targetAudience: true,
        contentPillars: true,
        brandVoice: true,
        optimizationGoal: true,
        reviewWindowEnabled: true,
        reviewWindowHours: true,
        postingCadence: true,
        formatMix: true,
        researchSources: true,
        optimalTimeWindows: true,
        lastOptimizedAt: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!isAdmin && !membership) {
    return (
      <div className="text-center py-16 text-zinc-400">
        <p>You do not have access to this workspace.</p>
      </div>
    );
  }

  const isOwner = isAdmin || membership?.role === "OWNER";

  if (!strategy) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-full bg-violet-600/10 p-4 mb-4">
          <svg
            className="h-12 w-12 text-violet-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-zinc-100 mb-2">
          No content strategy yet
        </h2>
        <p className="text-zinc-400 mb-6 max-w-md">
          Complete the onboarding wizard to generate your AI-powered content strategy.
        </p>
        <a
          href={`/dashboard/businesses/${activeBusinessId}/onboard`}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
        >
          Complete setup
        </a>
      </div>
    );
  }

  // Serialize Date fields for client component
  const serialized = {
    ...strategy,
    lastOptimizedAt: strategy.lastOptimizedAt?.toISOString() ?? null,
    updatedAt: strategy.updatedAt.toISOString(),
  };

  return (
    <StrategyClient
      key={activeBusinessId}
      initialStrategy={serialized}
      businessId={activeBusinessId}
      isOwner={isOwner}
    />
  );
}
