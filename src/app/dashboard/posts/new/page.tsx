import { PostComposer } from "@/components/posts/PostComposer";

export default function NewPostPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">New Post</h1>
        <p className="text-zinc-400 mt-1">Compose and schedule your social media post.</p>
      </div>
      <PostComposer />
    </div>
  );
}
