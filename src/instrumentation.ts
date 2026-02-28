export async function register() {
  // Only run in Node.js runtime (not Edge) and never during tests
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV !== "test"
  ) {
    const { schedulePostPublisher } = await import("@/lib/scheduler");
    schedulePostPublisher();
  }
}
