import { env } from "@/env";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: AuthOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma) as any,
  session: { strategy: "jwt" },
  secret: env.NEXTAUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const allowed = env.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase());
      return allowed.includes((user.email ?? "").toLowerCase());
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.sub = user.id;
        // On sign-in: resolve the user's active business
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { activeBusinessId: true },
        });
        if (dbUser?.activeBusinessId) {
          token.activeBusinessId = dbUser.activeBusinessId;
        } else {
          // Fall back to first business the user belongs to
          const membership = await prisma.businessMember.findFirst({
            where: { userId: user.id },
            orderBy: { joinedAt: "asc" },
          });
          token.activeBusinessId = membership?.businessId ?? null;
        }
      }
      // Client can trigger a session update via update({ activeBusinessId })
      if (trigger === "update" && typeof session?.activeBusinessId === "string") {
        token.activeBusinessId = session.activeBusinessId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.sub && session.user) {
        session.user.id = token.sub;
        (session.user as { id: string; activeBusinessId?: string | null }).activeBusinessId =
          (token.activeBusinessId as string | null) ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
};
