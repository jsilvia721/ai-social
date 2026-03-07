"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Sparkles, CheckCircle2 } from "lucide-react";

type WizardAnswers = Record<string, string>;

const STEPS = [
  {
    key: "businessType",
    question: "What does your business do?",
    placeholder:
      "e.g. Boutique fitness studio specializing in HIIT classes for busy professionals",
    hint: "Be specific — this shapes every piece of content we create.",
  },
  {
    key: "targetAudience",
    question: "Who is your ideal customer?",
    placeholder:
      "e.g. Professionals aged 28-45, mostly female, value work-life balance, time-poor but health-conscious",
    hint: "Include demographics, psychographics, and what they care about most.",
  },
  {
    key: "tonePreference",
    question: "How would you describe your brand voice?",
    placeholder:
      "e.g. Energetic, no-nonsense, science-backed — like a knowledgeable friend, not a salesperson",
    hint: "Think of how you talk to your best clients in person.",
  },
  {
    key: "primaryGoal",
    question: "What is your #1 goal for social media right now?",
    placeholder:
      "e.g. Grow Instagram following to drive class bookings, build authority on LinkedIn, increase DM inquiries",
    hint: "We'll optimize posting strategy around this goal.",
  },
  {
    key: "competitors",
    question: "Who do you admire or compete with? (optional)",
    placeholder:
      "e.g. @CrossFitHQ for their community energy, @hubermanlab for science-credibility format",
    hint: "These help calibrate the content style — skip if unsure.",
  },
];

const LOADING_MESSAGES = [
  "Analyzing your audience...",
  "Crafting content pillars...",
  "Building your brand voice...",
  "Defining your strategy...",
  "Almost there...",
];

export default function OnboardPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const businessId = params.id;

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<WizardAnswers>({});
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Cycle loading messages every 2 seconds
  useEffect(() => {
    if (!isSubmitting) return;
    const interval = setInterval(
      () => setLoadingMsg((m) => (m + 1) % LOADING_MESSAGES.length),
      2000
    );
    return () => clearInterval(interval);
  }, [isSubmitting]);

  const currentStep = STEPS[step];
  const isLastStep = step === STEPS.length - 1;
  const isOptionalStep = step === STEPS.length - 1; // competitors step is optional

  function handleNext() {
    const trimmed = currentAnswer.trim();
    if (!trimmed && !isOptionalStep) return;

    const updatedAnswers = { ...answers };
    if (trimmed) updatedAnswers[currentStep.key] = trimmed;

    if (isLastStep) {
      submitStrategy(updatedAnswers);
    } else {
      setAnswers(updatedAnswers);
      setCurrentAnswer(answers[STEPS[step + 1]?.key] ?? "");
      setStep((s) => s + 1);
    }
  }

  function handleBack() {
    if (step === 0) return;
    setAnswers((prev) => ({ ...prev, [currentStep.key]: currentAnswer.trim() }));
    setCurrentAnswer(answers[STEPS[step - 1].key] ?? "");
    setStep((s) => s - 1);
  }

  const submitStrategy = useCallback(
    async (finalAnswers: WizardAnswers) => {
      setIsSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`/api/businesses/${businessId}/onboard`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: finalAnswers }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Something went wrong");
        }
        setDone(true);
        setTimeout(() => router.push("/dashboard/accounts"), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setIsSubmitting(false);
      }
    },
    [businessId, router]
  );

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
        <CheckCircle2 className="h-16 w-16 text-emerald-400" />
        <h2 className="text-2xl font-bold text-zinc-50">Strategy created!</h2>
        <p className="text-zinc-400">Redirecting to connect your social accounts...</p>
      </div>
    );
  }

  if (isSubmitting) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <Sparkles className="h-12 w-12 text-violet-400 animate-pulse" />
        <div>
          <h2 className="text-xl font-semibold text-zinc-100 mb-2">
            Building your content strategy...
          </h2>
          <p className="text-zinc-400 transition-all duration-500">
            {LOADING_MESSAGES[loadingMsg]}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-8">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
          <span>{Math.round(((step + 1) / STEPS.length) * 100)}%</span>
        </div>
        <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-600 rounded-full transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50 mb-2">
            {currentStep.question}
          </h1>
          <p className="text-sm text-zinc-500">{currentStep.hint}</p>
        </div>

        <div className="space-y-2">
          <Textarea
            id="answer"
            value={currentAnswer}
            onChange={(e) => setCurrentAnswer(e.target.value)}
            placeholder={currentStep.placeholder}
            rows={4}
            className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 resize-none focus:border-violet-500 focus:ring-violet-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleNext();
              }
            }}
          />
          {isOptionalStep && (
            <p className="text-xs text-zinc-600">This step is optional — press Next to skip.</p>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-red-900/20 border border-red-800 px-4 py-3 text-sm text-red-400">
            {error} —{" "}
            <button
              onClick={() => submitStrategy(answers)}
              className="underline hover:text-red-300"
            >
              Try again
            </button>
          </div>
        )}

        <div className="flex gap-3">
          {step > 0 && (
            <Button
              variant="outline"
              onClick={handleBack}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          )}
          <Button
            onClick={handleNext}
            disabled={!currentAnswer.trim() && !isOptionalStep}
            className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-40"
          >
            {isLastStep ? (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate strategy
              </>
            ) : (
              <>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>

        <p className="text-xs text-zinc-600 text-center">
          Press{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono">
            ⌘ Enter
          </kbd>{" "}
          to continue
        </p>
      </div>
    </div>
  );
}
