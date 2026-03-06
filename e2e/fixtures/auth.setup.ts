import { test as setup, expect } from "@playwright/test";
import path from "path";

export const authFile = path.join(__dirname, "../.auth/user.json");

setup("authenticate as test user", async ({ request, context }) => {
  // Hit the test-only session endpoint to mint a real NextAuth JWT cookie.
  // The endpoint upserts the user in the DB and sets next-auth.session-token.
  const res = await request.get(
    "/api/test/session?email=test@example.com"
  );
  expect(res.ok()).toBeTruthy();

  // Save the browser context state (cookies) so all test specs can reuse it.
  await context.storageState({ path: authFile });
});
