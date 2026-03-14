"use client";

import { useState, useRef } from "react";
import { MessageSquare, Loader2, Paperclip, X } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_MESSAGE_LENGTH = 5000;
const CHAR_WARNING_THRESHOLD = 4000;
const AUTO_CLOSE_DELAY = 2000;

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ issueUrl?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function resetState() {
    setMessage("");
    setScreenshot(null);
    setIsUploading(false);
    setIsSubmitting(false);
    setError(null);
    setUploadError(null);
    setSuccess(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (autoCloseTimer.current) {
      clearTimeout(autoCloseTimer.current);
      autoCloseTimer.current = null;
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetState();
    }
  }

  async function handleScreenshotUpload(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const data = await res.json();
      setScreenshot({ url: data.url, name: file.name });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } finally {
      setIsUploading(false);
    }
  }

  function removeScreenshot() {
    setScreenshot(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleSubmit() {
    if (!message.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        message: message.trim(),
        pageUrl: window.location.href,
        ...(screenshot && { screenshotUrl: screenshot.url }),
        metadata: { userAgent: navigator.userAgent },
      };

      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit feedback");
      }

      const data = await res.json();
      setSuccess({ issueUrl: data.githubIssueUrl });

      autoCloseTimer.current = setTimeout(() => {
        handleOpenChange(false);
      }, AUTO_CLOSE_DELAY);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit feedback"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-950 min-w-[44px] min-h-[44px]"
            aria-label="Feedback"
          >
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">Feedback</span>
          </button>
        </DialogTrigger>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>
              Bug, idea, or anything else — we&apos;d love to hear it.
            </DialogDescription>
          </DialogHeader>

          {success ? (
            <div className="py-4 text-center">
              <p className="text-sm text-emerald-400 font-medium">
                Thank you for your feedback!
              </p>
              {success.issueUrl && (
                <a
                  href={success.issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:underline mt-1 inline-block"
                >
                  View issue on GitHub
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="feedback-message" className="sr-only">
                  Feedback message
                </label>
                <Textarea
                  id="feedback-message"
                  placeholder="What's on your mind? Bug, idea, or anything else..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={MAX_MESSAGE_LENGTH}
                  rows={4}
                  className="resize-none"
                />
                {message.length > CHAR_WARNING_THRESHOLD && (
                  <p className="text-xs text-zinc-400 mt-1 text-right">
                    {message.length} / {MAX_MESSAGE_LENGTH}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                {screenshot ? (
                  <div className="flex items-center gap-2 text-sm text-zinc-300 bg-zinc-800 rounded-md px-3 py-2">
                    <Paperclip className="h-3.5 w-3.5 text-zinc-400" />
                    <span className="truncate flex-1">{screenshot.name}</span>
                    <button
                      type="button"
                      onClick={removeScreenshot}
                      className="text-zinc-500 hover:text-zinc-300"
                      aria-label="Remove screenshot"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div>
                    <label
                      htmlFor="feedback-screenshot"
                      className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-300 cursor-pointer transition-colors"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {isUploading ? "Uploading..." : "Attach screenshot"}
                    </label>
                    <input
                      id="feedback-screenshot"
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleScreenshotUpload}
                      className="hidden"
                      disabled={isUploading}
                    />
                  </div>
                )}

                {uploadError && (
                  <p className="text-xs text-red-400">{uploadError}</p>
                )}
              </div>

              {error && (
                <p role="alert" className="text-sm text-red-400">
                  {error}
                </p>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={handleSubmit}
                  disabled={!message.trim() || isSubmitting}
                  size="sm"
                >
                  {isSubmitting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  )}
                  Send
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
