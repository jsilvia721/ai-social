export default $config({
  app(input) {
    return {
      name: "ai-social",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage ?? ""),
      home: "aws",
      providers: { aws: { region: "us-east-1" } },
    };
  },

  async run() {
    // ── Secrets (SSM Parameter Store, free standard tier) ──────────
    const secrets = {
      databaseUrl:         new sst.Secret("DatabaseUrl"),
      nextauthSecret:      new sst.Secret("NextauthSecret"),
      nextauthUrl:         new sst.Secret("NextauthUrl"),
      googleClientId:      new sst.Secret("GoogleClientId"),
      googleClientSecret:  new sst.Secret("GoogleClientSecret"),
      twitterClientId:     new sst.Secret("TwitterClientId"),
      twitterClientSecret: new sst.Secret("TwitterClientSecret"),
      metaAppId:           new sst.Secret("MetaAppId"),
      metaAppSecret:       new sst.Secret("MetaAppSecret"),
      anthropicKey:        new sst.Secret("AnthropicApiKey"),
      // Replicate: optional — set ReplicateApiToken secret to enable image generation
      replicateApiToken:   null,
      tiktokClientId:      new sst.Secret("TiktokClientId"),
      tiktokClientSecret:  new sst.Secret("TiktokClientSecret"),
      tokenEncryptionKey:  new sst.Secret("TokenEncryptionKey"),
      allowedEmails:       new sst.Secret("AllowedEmails"),
      // Blotato: set BlotatoApiKey secret per stage (real key for production, "mock" for staging)
      blotatoApiKey:       new sst.Secret("BlotatoApiKey"),
      // SES_FROM_EMAIL: optional — set SesFromEmail secret to enable failure alert emails
      sesFromEmail:        null,
      // GitHub: optional — set GitHubToken secret to enable brainstorm agent
      githubToken:         new sst.Secret("GithubToken"),
      // ADMIN_EMAILS: optional — comma-separated emails to auto-promote to admin on sign-in
      adminEmails:         new sst.Secret("AdminEmails"),
    };

    // ── S3 Bucket ──────────────────────────────────────────────────
    const bucket = new sst.aws.Bucket("Storage", {
      public: true,
      cors: [
        { allowedMethods: ["GET"], allowedOrigins: ["*"] },
        {
          allowedMethods: ["PUT", "POST"],
          allowedOrigins: [
            "https://d11oxnidmahp76.cloudfront.net",
            "https://*.cloudfront.net",
            "http://localhost:3000",
          ],
          allowedHeaders: ["Content-Type", "Content-Length"],
          exposeHeaders: ["ETag"],
        },
      ],
      transform: {
        bucket: { forceDestroy: false },
      },
    });

    // Explicitly map secrets to the env var names the app expects.
    // SST's link mechanism injects as SST_RESOURCE_* which our app doesn't read.
    const environment = {
      NODE_ENV: "production",
      AWS_S3_BUCKET: bucket.name,
      AWS_S3_PUBLIC_URL: $interpolate`https://${bucket.domain}`,
      DATABASE_URL:          secrets.databaseUrl.value,
      NEXTAUTH_SECRET:       secrets.nextauthSecret.value,
      NEXTAUTH_URL:          secrets.nextauthUrl.value,
      GOOGLE_CLIENT_ID:      secrets.googleClientId.value,
      GOOGLE_CLIENT_SECRET:  secrets.googleClientSecret.value,
      TWITTER_CLIENT_ID:     secrets.twitterClientId.value,
      TWITTER_CLIENT_SECRET: secrets.twitterClientSecret.value,
      META_APP_ID:           secrets.metaAppId.value,
      META_APP_SECRET:       secrets.metaAppSecret.value,
      ANTHROPIC_API_KEY:     secrets.anthropicKey.value,
      // Replicate: image generation disabled until ReplicateApiToken secret is configured
      TIKTOK_CLIENT_ID:      secrets.tiktokClientId.value,
      TIKTOK_CLIENT_SECRET:  secrets.tiktokClientSecret.value,
      TOKEN_ENCRYPTION_KEY:  secrets.tokenEncryptionKey.value,
      ALLOWED_EMAILS:        secrets.allowedEmails.value,
      // BLOTATO_MOCK: controls dev-tools visibility in dashboard layout and dev seed route
      BLOTATO_MOCK:          $app.stage === "production" ? "false" : "true",
      // MOCK_EXTERNAL_APIS: controls shouldMockExternalApis() gating in src/lib/mocks/config.ts
      MOCK_EXTERNAL_APIS:    $app.stage === "production" ? "false" : "true",
      BLOTATO_API_KEY:       secrets.blotatoApiKey.value,
      // SES failure alerts: disabled until SesFromEmail secret is configured
      // Admin role bootstrap: optional, comma-separated emails granted isAdmin on sign-in
      ...(secrets.adminEmails ? { ADMIN_EMAILS: secrets.adminEmails.value } : {}),
      // GitHub token: requires `issues: write` + `contents: read` for fine-grained PATs,
      // or `repo` scope for classic PATs. Used by brainstorm agent to create/read issues.
      ...(secrets.githubToken ? { GITHUB_TOKEN: secrets.githubToken.value } : {}),
      GITHUB_REPO_OWNER: "jsilvia721",
      GITHUB_REPO_NAME: "ai-social",
      GITHUB_BOT_USERNAME: "jsilvia721",
      // Enable test auth endpoint on non-production stages for Playwright E2E
      PLAYWRIGHT_E2E: $app.stage !== "production" ? "true" : "",
    };

    // ── Next.js App ───────────────────────────────────────────────
    new sst.aws.Nextjs("Web", {
      link: [bucket],
      environment,
      transform: {
        server: {
          logging: { retention: "1 month" },
        },
      },
    });

    // ── Cron: Post Publisher (every 1 minute) ─────────────────────
    new sst.aws.Cron("PostPublisher", {
      schedule: "rate(1 minute)",
      job: {
        handler: "src/cron/publish.handler",
        environment,
        timeout: "55 seconds",
        logging: { retention: "1 month" },
        concurrency: 1,
      },
    });

    // ── Cron: Metrics Refresh (every 1 hour) ──────────────────────
    new sst.aws.Cron("MetricsRefresh", {
      schedule: "rate(60 minutes)",
      job: {
        handler: "src/cron/metrics.handler",
        environment,
        timeout: "5 minutes",
        logging: { retention: "1 month" },
      },
    });

    // ── Cron: Research Pipeline (every 4 hours) ─────────────────
    new sst.aws.Cron("ResearchPipeline", {
      schedule: "cron(0 */4 * * ? *)",
      job: {
        handler: "src/cron/research.handler",
        environment,
        timeout: "5 minutes",
        logging: { retention: "1 month" },
      },
    });

    // ── Cron: Brief Generator (Sunday 23:00 UTC) ────────────────
    new sst.aws.Cron("BriefGenerator", {
      schedule: "cron(0 23 ? * SUN *)",
      job: {
        handler: "src/cron/briefs.handler",
        environment,
        timeout: "5 minutes",
        logging: { retention: "1 month" },
      },
    });

    // ── Cron: Brief Fulfillment (every 6 hours) ────────────────
    new sst.aws.Cron("BriefFulfillment", {
      schedule: "rate(6 hours)",
      job: {
        handler: "src/cron/fulfill.handler",
        environment,
        timeout: "5 minutes",
        logging: { retention: "1 month" },
        concurrency: 1,
      },
    });

    // ── Cron: Strategy Optimizer (Sunday 02:00 UTC) ─────────────
    new sst.aws.Cron("StrategyOptimizer", {
      schedule: "cron(0 2 ? * SUN *)",
      job: {
        handler: "src/cron/optimize.handler",
        environment,
        timeout: "5 minutes",
        logging: { retention: "1 month" },
        concurrency: 1,
      },
    });
    // ── Cron: Brainstorm Agent (every 60 minutes) ─────────────────
    new sst.aws.Cron("BrainstormAgent", {
      schedule: "rate(60 minutes)",
      job: {
        handler: "src/cron/brainstorm.handler",
        environment,
        timeout: "5 minutes",
        logging: { retention: "1 month" },
        concurrency: 1,
      },
    });
  },
});
