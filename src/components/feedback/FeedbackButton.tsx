"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
} from "@/components/ui/dialog";
import { FeedbackChat } from "./FeedbackChat";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
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

        <DialogContent
          className="flex flex-col fixed inset-0 max-w-none translate-x-0 translate-y-0 top-0 left-0 rounded-none h-dvh w-dvw md:inset-auto md:top-[50%] md:left-[50%] md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-lg md:h-auto md:max-h-[80vh] md:w-full md:max-w-lg p-0"
          showCloseButton={false}
        >
          {open && (
            <FeedbackChat
              onClose={() => handleOpenChange(false)}
              onSuccess={() => {
                // FeedbackChat shows its own success state;
                // no additional action needed here
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
