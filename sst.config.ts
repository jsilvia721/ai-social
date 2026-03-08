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
      tiktokClientId:      new sst.Secret("TiktokClientId"),
      tiktokClientSecret:  new sst.Secret("TiktokClientSecret"),
      tokenEncryptionKey:  new sst.Secret("TokenEncryptionKey"),
      allowedEmails:       new sst.Secret("AllowedEmails"),
      // Blotato: only need the real secret in production (staging uses mock mode)
      blotatoApiKey:       $app.stage === "production" ? new sst.Secret("BlotatoApiKey") : null,
      // SES_FROM_EMAIL: optional — only needed in production for failure alerts
      sesFromEmail:        $app.stage === "production" ? new sst.Secret("SesFromEmail") : null,
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
      TIKTOK_CLIENT_ID:      secrets.tiktokClientId.value,
      TIKTOK_CLIENT_SECRET:  secrets.tiktokClientSecret.value,
      TOKEN_ENCRYPTION_KEY:  secrets.tokenEncryptionKey.value,
      ALLOWED_EMAILS:        secrets.allowedEmails.value,
      // Mock Blotato OAuth in non-production so a real API key isn't required
      BLOTATO_MOCK:          $app.stage !== "production" ? "true" : "false",
      ...(secrets.blotatoApiKey ? { BLOTATO_API_KEY: secrets.blotatoApiKey.value } : { BLOTATO_API_KEY: "mock" }),
      // SES failure alerts: only wired up in production
      ...(secrets.sesFromEmail ? { SES_FROM_EMAIL: secrets.sesFromEmail.value } : {}),
      // Admin role bootstrap: optional, comma-separated emails granted isAdmin on sign-in
      ...(secrets.adminEmails ? { ADMIN_EMAILS: secrets.adminEmails.value } : {}),
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
  },
});
