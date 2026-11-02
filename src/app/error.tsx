"use client";

import { Button } from "@/components/ui";

// Client error boundary: strings are inline because server i18n is not available here.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong · कुछ गड़बड़ हुई</h1>
      <p className="mt-2 text-[15px] text-ink-2">We could not load this page. Your data is safe.</p>
      <Button className="mt-6" onClick={reset}>
        Try again · फिर से कोशिश करें
      </Button>
    </main>
  );
}
