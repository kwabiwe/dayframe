import { createContext, type ReactNode } from "react";

export type ReportsSheetPortalHost = {
  isPresented: boolean;
  present: (sheet: ReactNode) => void;
};

export const ReportsSheetPortalContext =
  createContext<ReportsSheetPortalHost | null>(null);
