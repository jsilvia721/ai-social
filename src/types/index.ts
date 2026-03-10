export type Platform = "TWITTER" | "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE";
export type PostStatus = "DRAFT" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "PENDING_REVIEW" | "RETRYING";

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
