"use client";

import { LogOut } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

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
  }

  return (
    <form className="sign-out-form" action="/logout" method="post" onSubmit={submit}>
      <button className={className} type="submit" disabled={pending} aria-live="polite">
        {showIcon ? <LogOut size={17} aria-hidden="true" /> : null}
        {pending ? "Signing out…" : "Log out"}
      </button>
    </form>
  );
}
