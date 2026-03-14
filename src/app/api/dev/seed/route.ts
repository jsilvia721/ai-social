import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { Platform } from "@prisma/client";

function isDevToolsEnabled(): boolean {
  return (
    process.env.BLOTATO_MOCK === "true" ||
    process.env.NODE_ENV === "development"
  );
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  if (!isDevToolsEnabled()) return forbidden();

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action: string;
    businessId?: string;
  };

  const businessId = body.businessId;
  if (!businessId) {
    return NextResponse.json(
      { error: "businessId is required" },
      { status: 400 }
    );
  }

  // Verify user has access to this business (admin or member)
  const isAdmin = session.user.isAdmin ?? false;
  if (!isAdmin) {
    const membership = await prisma.businessMember.findFirst({
      where: { userId: session.user.id, businessId },
    });
    if (!membership) return forbidden();
  }

  switch (body.action) {
    case "seed-accounts":
      return seedAccounts(businessId);
    case "seed-posts":
      return seedPosts(businessId);
    case "seed-briefs":
      return seedBriefs(businessId);
    case "seed-research":
      return seedResearch(businessId);
    case "seed-insights":
      return seedInsights(businessId);
    case "seed-all":
      await seedAccountsData(businessId);
      await seedPostsData(businessId);
      await seedResearchData(businessId);
      await seedBriefsData(businessId);
      await seedInsightsData(businessId);
      return NextResponse.json({ message: "All test data seeded" });
    case "clear":
      return clearWorkspace(businessId);
    default:
      return NextResponse.json(
        { error: `Unknown action: ${body.action}` },
        { status: 400 }
      );
  }
}

// ── Seed social accounts ──────────────────────────────────────────────────────

const ACCOUNT_DEFS = [
  {
    platform: "TWITTER" as const,
    platformId: "seed-tw-001",
    username: "acme_brand",
    blotatoAccountId: "seed-blotato-tw-001",
  },
  {
    platform: "INSTAGRAM" as const,
    platformId: "seed-ig-001",
    username: "acme.brand",
    blotatoAccountId: "seed-blotato-ig-001",
  },
  {
    platform: "FACEBOOK" as const,
    platformId: "seed-fb-001",
    username: "AcmeBrand",
    blotatoAccountId: "seed-blotato-fb-001",
  },
  {
    platform: "TIKTOK" as const,
    platformId: "seed-tt-001",
    username: "acme_brand",
    blotatoAccountId: "seed-blotato-tt-001",
  },
  {
    platform: "YOUTUBE" as const,
    platformId: "seed-yt-001",
    username: "AcmeBrand",
    blotatoAccountId: "seed-blotato-yt-001",
  },
];

async function seedAccountsData(businessId: string) {
  const results = [];
  for (const def of ACCOUNT_DEFS) {
    const account = await prisma.socialAccount.upsert({
      where: {
        platform_platformId: {
          platform: def.platform,
          platformId: def.platformId,
        },
      },
      update: { businessId, username: def.username },
      create: { ...def, businessId },
    });
    results.push(account);
  }
  return results;
}

async function seedAccounts(businessId: string) {
  const accounts = await seedAccountsData(businessId);
  return NextResponse.json({
    message: `Seeded ${accounts.length} social accounts`,
    count: accounts.length,
  });
}

// ── Seed posts ────────────────────────────────────────────────────────────────

const POST_TEMPLATES = [
  // Drafts
  {
    content:
      "Excited to announce our new product line! Stay tuned for the big reveal next week. #innovation #comingsoon",
    status: "DRAFT" as const,
    platformPref: "TWITTER" as Platform,
  },
  {
    content:
      "Behind the scenes of our latest photoshoot. The team has been working incredibly hard to bring this vision to life.",
    status: "DRAFT" as const,
    platformPref: "INSTAGRAM" as Platform,
  },
  // Scheduled
  {
    content:
      "Join us LIVE tomorrow at 2PM EST for an exclusive Q&A with our CEO. Drop your questions below!",
    status: "SCHEDULED" as const,
    platformPref: "TWITTER" as Platform,
    scheduledOffsetHours: 24,
  },
  {
    content:
      "New blog post: 10 Tips for Growing Your Social Media Presence in 2026. Link in bio! #socialmedia #growthtips",
    status: "SCHEDULED" as const,
    platformPref: "INSTAGRAM" as Platform,
    scheduledOffsetHours: 48,
  },
  {
    content:
      "We're hiring! Looking for a creative content strategist to join our remote team. Apply now at acme.co/careers",
    status: "SCHEDULED" as const,
    platformPref: "FACEBOOK" as Platform,
    scheduledOffsetHours: 72,
  },
  // Published with metrics
  {
    content:
      "Thank you for 10K followers! Your support means everything to us. Here's to the next milestone!",
    status: "PUBLISHED" as const,
    platformPref: "TWITTER" as Platform,
    publishedOffsetHours: -48,
    metrics: {
      likes: 342,
      comments: 56,
      shares: 89,
      impressions: 15200,
      reach: 8400,
    },
  },
  {
    content:
      "Our summer collection just dropped! Which piece is your favorite? Comment below and you could win a gift card.",
    status: "PUBLISHED" as const,
    platformPref: "INSTAGRAM" as Platform,
    publishedOffsetHours: -24,
    metrics: {
      likes: 1205,
      comments: 234,
      shares: 67,
      impressions: 42000,
      reach: 28000,
      saves: 189,
    },
  },
  {
    content:
      "Monday motivation: Success isn't about the destination, it's about the journey. What's your goal this week?",
    status: "PUBLISHED" as const,
    platformPref: "FACEBOOK" as Platform,
    publishedOffsetHours: -72,
    metrics: {
      likes: 89,
      comments: 12,
      shares: 23,
      impressions: 3400,
      reach: 2100,
    },
  },
  {
    content:
      "Quick tutorial: How to set up your first social media campaign in under 5 minutes. #howto #tutorial",
    status: "PUBLISHED" as const,
    platformPref: "TIKTOK" as Platform,
    publishedOffsetHours: -96,
    metrics: {
      likes: 4523,
      comments: 312,
      shares: 890,
      impressions: 125000,
      reach: 95000,
    },
  },
  // Failed
  {
    content:
      "Check out our latest case study: How Brand X increased engagement by 300% using our platform.",
    status: "FAILED" as const,
    platformPref: "TWITTER" as Platform,
    errorMessage: "Rate limit exceeded. Please try again later.",
  },
  // Pending review
  {
    content:
      "Introducing our AI-powered content assistant — create better posts in half the time. Try it free for 14 days!",
    status: "PENDING_REVIEW" as const,
    platformPref: "INSTAGRAM" as Platform,
    scheduledOffsetHours: 36,
  },
];

interface PostTemplate {
  content: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED" | "PENDING_REVIEW";
  platformPref: Platform;
  scheduledOffsetHours?: number;
  publishedOffsetHours?: number;
  errorMessage?: string;
  metrics?: {
    likes?: number;
    comments?: number;
    shares?: number;
    impressions?: number;
    reach?: number;
    saves?: number;
  };
}

async function seedPostsData(businessId: string) {
  // Get or create accounts first
  const accounts = await prisma.socialAccount.findMany({
    where: { businessId },
  });

  if (accounts.length === 0) {
    // Seed accounts first if none exist
    await seedAccountsData(businessId);
    return seedPostsData(businessId);
  }

  const accountByPlatform = new Map(accounts.map((a) => [a.platform, a]));
  const now = new Date();
  const posts = [];

  for (const template of POST_TEMPLATES as PostTemplate[]) {
    const account =
      accountByPlatform.get(template.platformPref) ?? accounts[0];

    const scheduledAt = template.scheduledOffsetHours
      ? new Date(now.getTime() + template.scheduledOffsetHours * 3600000)
      : undefined;
    const publishedAt = template.publishedOffsetHours
      ? new Date(now.getTime() + template.publishedOffsetHours * 3600000)
      : undefined;

    const post = await prisma.post.create({
      data: {
        businessId,
        socialAccountId: account.id,
        content: template.content,
        status: template.status,
        scheduledAt,
        publishedAt,
        errorMessage: template.errorMessage,
        metricsLikes: template.metrics?.likes,
        metricsComments: template.metrics?.comments,
        metricsShares: template.metrics?.shares,
        metricsImpressions: template.metrics?.impressions,
        metricsReach: template.metrics?.reach,
        metricsSaves: template.metrics?.saves,
        metricsUpdatedAt: template.metrics ? now : undefined,
        reviewWindowExpiresAt:
          template.status === "PENDING_REVIEW" && scheduledAt
            ? new Date(scheduledAt.getTime() + 24 * 3600000)
            : undefined,
      },
    });
    posts.push(post);
  }

  return posts;
}

async function seedPosts(businessId: string) {
  const posts = await seedPostsData(businessId);
  return NextResponse.json({
    message: `Seeded ${posts.length} posts`,
    count: posts.length,
  });
}

// ── Seed research summaries ───────────────────────────────────────────────────

async function seedResearchData(businessId: string) {
  const summary = await prisma.researchSummary.create({
    data: {
      businessId,
      sourcesUsed: ["google_trends", "rss", "reddit"],
      sourceItems: {
        google_trends: [
          { keyword: "AI marketing tools", interest: 92 },
          { keyword: "social media automation", interest: 85 },
          { keyword: "content strategy 2026", interest: 78 },
        ],
        rss: [
          {
            title: "The Future of AI in Content Marketing",
            source: "MarketingBrew",
            url: "https://example.com/ai-content-marketing",
          },
          {
            title: "5 Social Media Trends to Watch",
            source: "SocialMediaToday",
            url: "https://example.com/social-trends",
          },
        ],
        reddit: [
          {
            subreddit: "r/socialmedia",
            title: "Best tools for scheduling posts?",
            score: 234,
          },
          {
            subreddit: "r/marketing",
            title: "AI-generated content: worth it?",
            score: 189,
          },
        ],
      },
      synthesizedThemes:
        "Three dominant themes emerge from this week's research:\n\n" +
        "1. **AI-Powered Content Creation** — Interest in AI marketing tools is at an all-time high (92/100 on Google Trends). " +
        "Brands are increasingly adopting AI assistants for content ideation and first-draft generation, though human editing remains essential.\n\n" +
        "2. **Authentic Engagement Over Reach** — Reddit discussions and industry blogs emphasize that algorithm changes across platforms " +
        "are rewarding genuine community interaction over vanity metrics. Comments and shares now carry more weight than impressions.\n\n" +
        "3. **Video-First Strategy** — Short-form video (TikTok, Reels, Shorts) continues to dominate. RSS feeds from major marketing " +
        "publications consistently highlight video as the highest-ROI format, with carousel posts as a strong runner-up for Instagram.",
    },
  });
  return summary;
}

async function seedResearch(businessId: string) {
  const summary = await seedResearchData(businessId);
  return NextResponse.json({
    message: "Seeded 1 research summary",
    id: summary.id,
  });
}

// ── Seed content briefs ───────────────────────────────────────────────────────

const BRIEF_DEFS = [
  {
    topic: "AI Tools Roundup",
    rationale:
      "Google Trends shows 92/100 interest in AI marketing tools. A roundup post positions us as a thought leader and drives engagement from marketers exploring new tools.",
    suggestedCaption:
      "We tested 10 AI marketing tools so you don't have to. Here are the 3 that actually delivered results (and the ones we'd skip). Thread below.",
    contentGuidance:
      "Use a numbered list format. Include specific metrics or results from each tool. End with a CTA asking followers about their favorite tools.",
    recommendedFormat: "TEXT" as const,
    platform: "TWITTER" as const,
    status: "PENDING" as const,
    offsetDays: 1,
  },
  {
    topic: "Behind-the-Scenes Content Creation",
    rationale:
      "Authentic behind-the-scenes content consistently outperforms polished posts on Instagram. Reddit discussions confirm audiences crave transparency.",
    suggestedCaption:
      "POV: You're watching our content team build next week's campaign from scratch. No filters, no scripts — just the real creative process.",
    aiImagePrompt:
      "A bright, modern office space with a diverse team huddled around a large screen showing social media analytics, natural lighting, candid shot style",
    contentGuidance:
      "Use carousel format with 5-7 slides showing the progression from idea to finished post. Include team members' faces for authenticity.",
    recommendedFormat: "CAROUSEL" as const,
    platform: "INSTAGRAM" as const,
    status: "PENDING" as const,
    offsetDays: 2,
  },
  {
    topic: "Social Media Scheduling Tips",
    rationale:
      "High Reddit engagement on scheduling tool discussions. Our product naturally fits as a solution — educational content that subtly showcases our features.",
    suggestedCaption:
      "Stop guessing when to post. Here's the data-backed posting schedule that tripled our engagement in 30 days. Save this for later!",
    contentGuidance:
      "Create an infographic-style image showing optimal posting times by platform. Include specific time zones and day-of-week recommendations.",
    recommendedFormat: "IMAGE" as const,
    platform: "FACEBOOK" as const,
    status: "FULFILLED" as const,
    offsetDays: -1,
  },
  {
    topic: "Quick Tutorial: First Campaign Setup",
    rationale:
      "TikTok tutorials under 60 seconds have the highest completion rates. A quick how-to video showcasing our platform drives product awareness.",
    suggestedCaption:
      "Set up your first social media campaign in under 60 seconds. Yes, really. #socialmediatips #marketinghacks #tutorial",
    contentGuidance:
      "Screen recording with face cam overlay. Fast-paced editing with text overlays highlighting key steps. Trending audio optional.",
    recommendedFormat: "VIDEO" as const,
    platform: "TIKTOK" as const,
    status: "PENDING" as const,
    offsetDays: 3,
  },
  {
    topic: "Weekly Engagement Wins",
    rationale:
      "Celebrating community milestones boosts follower loyalty. Our 10K milestone is a natural moment to thank the audience and drive further engagement.",
    suggestedCaption:
      "This week's wins: 10K followers milestone, 300% engagement increase on our tutorial series, and YOUR amazing comments that keep us going. What should we create next?",
    recommendedFormat: "TEXT" as const,
    platform: "TWITTER" as const,
    status: "EXPIRED" as const,
    offsetDays: -7,
  },
  {
    topic: "Industry Trends Report",
    rationale:
      "Monthly trend reports establish authority and are highly shareable. Synthesizing our research data into a digestible YouTube video captures a professional audience.",
    suggestedCaption:
      "March 2026 Social Media Trends Report: AI content is up 40%, video-first strategies dominate, and engagement beats reach. Full breakdown in the video.",
    contentGuidance:
      "5-8 minute video with screen shares of data visualizations. Professional but conversational tone. Include 3 actionable takeaways.",
    recommendedFormat: "VIDEO" as const,
    platform: "YOUTUBE" as const,
    status: "PENDING" as const,
    offsetDays: 5,
  },
];

async function seedBriefsData(businessId: string) {
  // Get or create the latest research summary for linking
  const latestResearch = await prisma.researchSummary.findFirst({
    where: { businessId },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
  weekStart.setHours(0, 0, 0, 0);

  const briefs = [];
  for (let i = 0; i < BRIEF_DEFS.length; i++) {
    const def = BRIEF_DEFS[i];
    const scheduledFor = new Date(
      now.getTime() + def.offsetDays * 24 * 3600000
    );

    const brief = await prisma.contentBrief.create({
      data: {
        businessId,
        researchSummaryId: latestResearch?.id,
        topic: def.topic,
        rationale: def.rationale,
        suggestedCaption: def.suggestedCaption,
        aiImagePrompt: def.aiImagePrompt,
        contentGuidance: def.contentGuidance,
        recommendedFormat: def.recommendedFormat,
        platform: def.platform,
        scheduledFor,
        status: def.status,
        weekOf: weekStart,
        sortOrder: i,
      },
    });
    briefs.push(brief);
  }

  return briefs;
}

async function seedBriefs(businessId: string) {
  const briefs = await seedBriefsData(businessId);
  return NextResponse.json({
    message: `Seeded ${briefs.length} content briefs`,
    count: briefs.length,
  });
}

// ── Seed strategy digest insights ─────────────────────────────────────────────

async function seedInsightsData(businessId: string) {
  // Get published posts to reference as top performers
  const publishedPosts = await prisma.post.findMany({
    where: { businessId, status: "PUBLISHED" },
    include: { socialAccount: { select: { platform: true } } },
    take: 10,
    orderBy: { publishedAt: "desc" },
  });

  // If no published posts exist, seed posts first
  if (publishedPosts.length === 0) {
    await seedAccountsData(businessId);
    await seedPostsData(businessId);
    return seedInsightsData(businessId);
  }

  const now = new Date();
  const digests = [];

  // Create 4 weeks of digest history
  for (let weekOffset = 0; weekOffset < 4; weekOffset++) {
    const weekOf = new Date(now);
    weekOf.setDate(weekOf.getDate() - weekOf.getDay() - weekOffset * 7); // Sunday of each week
    weekOf.setHours(0, 0, 0, 0);

    // Pick 2-3 top performers from available published posts
    const topPerformers = publishedPosts
      .slice(0, Math.min(3, publishedPosts.length))
      .map((post, i) => ({
        postId: post.id,
        score: parseFloat((4.5 - i * 0.8 - weekOffset * 0.3).toFixed(1)),
        format: ["VIDEO", "CAROUSEL", "IMAGE", "TEXT"][i % 4],
        topicPillar: ["Tips & Tutorials", "Behind the Scenes", "Product Updates", "Community"][i % 4],
      }));

    const SUMMARIES = [
      "Strong week overall. Video content outperformed all other formats by 2.5x, particularly the quick tutorial which reached 95K users. Instagram engagement is up 18% week-over-week, driven by carousel posts. Consider doubling down on short-form educational content.",
      "Engagement metrics improved across the board this week. Twitter saw the biggest gains with a 25% increase in retweets. The community-focused content resonated well — posts asking questions generated 3x more comments than promotional content.",
      "Mixed results this week. Facebook engagement dropped 12% while TikTok continues to surge. The behind-the-scenes content style is clearly resonating with younger demographics. Recommend shifting more resources to short-form video.",
      "Steady growth continues. Overall impressions up 8% week-over-week. The AI tools roundup thread on Twitter was the standout performer, generating significant discussion. Instagram Stories completion rates improved to 72%.",
    ];

    const INSIGHTS_SETS = [
      [
        "Video posts generate 2.5x more engagement than text-only posts",
        "Posts published between 9-11 AM EST get 40% higher reach",
        "Carousel posts on Instagram have the highest save rate (4.2%)",
        "Questions in post copy increase comment rate by 3x",
      ],
      [
        "Thread-style Twitter posts outperform single tweets by 180%",
        "User-generated content reposts drive 2x more shares",
        "Tuesday and Thursday are peak engagement days across platforms",
        "Posts with emojis in the first line get 25% more impressions",
      ],
      [
        "TikTok tutorials under 30 seconds have 85% completion rate",
        "Instagram Reels are now outperforming static image posts",
        "Facebook engagement peaks on weekday evenings (6-8 PM)",
      ],
      [
        "Consistent posting cadence (daily) correlates with 30% higher follower growth",
        "Behind-the-scenes content generates the most authentic engagement",
        "Cross-platform repurposing saves 60% of content creation time",
        "Hashtag usage on Twitter has diminishing returns after 3 tags",
      ],
    ];

    const FORMAT_MIX_SETS = [
      { VIDEO: 0.1, TEXT: -0.05, IMAGE: -0.05 },
      { CAROUSEL: 0.05, TEXT: -0.05 },
      { VIDEO: 0.15, IMAGE: -0.1, TEXT: -0.05 },
      {},
    ];

    const CADENCE_SETS = [
      { TWITTER: 1, TIKTOK: 1 },
      { INSTAGRAM: 1 },
      { TIKTOK: 2, FACEBOOK: -1 },
      { TWITTER: -1, YOUTUBE: 1 },
    ];

    const TOPIC_INSIGHTS_SETS = [
      ["Increase tutorial/how-to content — highest engagement category", "Reduce promotional posts — audience fatigue detected"],
      ["Lean into community-driven content — questions and polls", "Test more thread-style long-form on Twitter"],
      ["Double down on behind-the-scenes content", "Explore collaboration posts with industry peers"],
      [],
    ];

    const digest = await prisma.strategyDigest.upsert({
      where: { businessId_weekOf: { businessId, weekOf } },
      update: {
        summary: SUMMARIES[weekOffset],
        patterns: {
          topPerformers,
          insights: INSIGHTS_SETS[weekOffset],
        },
        changes: {
          formatMix: FORMAT_MIX_SETS[weekOffset],
          cadence: CADENCE_SETS[weekOffset],
          topicInsights: TOPIC_INSIGHTS_SETS[weekOffset],
        },
      },
      create: {
        businessId,
        weekOf,
        summary: SUMMARIES[weekOffset],
        patterns: {
          topPerformers,
          insights: INSIGHTS_SETS[weekOffset],
        },
        changes: {
          formatMix: FORMAT_MIX_SETS[weekOffset],
          cadence: CADENCE_SETS[weekOffset],
          topicInsights: TOPIC_INSIGHTS_SETS[weekOffset],
        },
      },
    });
    digests.push(digest);
  }

  return digests;
}

async function seedInsights(businessId: string) {
  const digests = await seedInsightsData(businessId);
  return NextResponse.json({
    message: `Seeded ${digests.length} weekly insight digests`,
    count: digests.length,
  });
}

// ── Clear workspace test data ─────────────────────────────────────────────────

async function clearWorkspace(businessId: string) {
  // Delete in dependency order
  const digests = await prisma.strategyDigest.deleteMany({
    where: { businessId },
  });
  const briefs = await prisma.contentBrief.deleteMany({
    where: { businessId },
  });
  const posts = await prisma.post.deleteMany({ where: { businessId } });
  const research = await prisma.researchSummary.deleteMany({
    where: { businessId },
  });
  const accounts = await prisma.socialAccount.deleteMany({
    where: { businessId },
  });
  const strategy = await prisma.contentStrategy.deleteMany({
    where: { businessId },
  });

  return NextResponse.json({
    message: "Cleared all workspace data",
    deleted: {
      strategyDigests: digests.count,
      contentBriefs: briefs.count,
      posts: posts.count,
      researchSummaries: research.count,
      socialAccounts: accounts.count,
      contentStrategies: strategy.count,
    },
  });
}
