"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { useRef, useState, type FormEvent } from "react";
import { beforeSessionChange } from "@/lib/session-change";

export function SignOutControl({
  className,
  showIcon = false
}: {
  className: string;
  showIcon?: boolean;
}) {
  const submissionStarted = useRef(false);
  const [pending, setPending] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    if (submissionStarted.current) {
      event.preventDefault();
      return;
    }
    submissionStarted.current = true;
    setPending(true);
    // Held Review decisions are saved before the session ends, then the form posts as usual.
    event.preventDefault();
    const form = event.currentTarget;
    void beforeSessionChange().finally(() => form.submit());
  }

  return (
    <form className="sign-out-form" action="/logout" method="post" onSubmit={submit}>
      <button className={className} type="submit" disabled={pending} aria-live="polite">
        {showIcon ? <DayframeIcon glyph="log-out" size={17}/> : null}
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}
