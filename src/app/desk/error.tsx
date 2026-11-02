"use client";

import { Button, ButtonLink } from "@/components/ui";

// Desk-level error boundary: header and tabs stay, so the desk can carry on with other work.
export default function DeskError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <h1 className="text-xl font-semibold">Something went wrong · कुछ गड़बड़ हुई</h1>
      <p className="mt-2 text-[15px] text-ink-2">This page could not load. Nothing was changed.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/desk" variant="secondary">
          Overview
        </ButtonLink>
      </div>
    </div>
  );
}
