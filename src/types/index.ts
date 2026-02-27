export type Platform = "TWITTER" | "INSTAGRAM" | "FACEBOOK";
export type PostStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";

export interface SocialAccount {
  id: string;
  platform: Platform;
  platformId: string;
  username: string;
  expiresAt: Date | null;
}

export interface Post {
  id: string;
  content: string;
  mediaUrls: string[];
  status: PostStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  socialAccountId: string;
  platform: Platform;
  errorMessage: string | null;
  createdAt: Date;
}

export interface SchedulePostInput {
  content: string;
  socialAccountId: string;
  scheduledAt: Date;
  mediaUrls?: string[];
}
