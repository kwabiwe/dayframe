"use client";

import dynamic from "next/dynamic";

/** The reset form reads the link's fragment, which only the browser has: client-only rendering. */
export const PasswordResetClient = dynamic(
  () => import("@/components/PasswordResetForm").then((module) => module.PasswordResetForm),
  { ssr: false }
);
