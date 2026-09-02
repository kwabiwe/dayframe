// Pure policy is shared; server ingest additionally verifies catalogue ownership
// and applies the canonical activity-aware overlap decision in its transaction.
export {
  assessAutomaticLocation as locationSemanticDisposition,
  type LocationAutomaticLoggingDecision as LocationSemanticDisposition
} from "@dayframe/shared";
