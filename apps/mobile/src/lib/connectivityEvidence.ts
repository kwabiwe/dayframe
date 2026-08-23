type ConnectivityEvidenceReporter = {
  requestGeneration: () => number;
  reportResponse: (input: {
    requestGeneration: number;
    completedAt?: number;
  }) => void;
  reportFailure: (input: {
    kind: "deadline" | "transport";
    occurredAt?: number;
    requestGeneration: number;
  }) => void;
};

let reporter: ConnectivityEvidenceReporter | null = null;

export function installConnectivityEvidenceReporter(
  nextReporter: ConnectivityEvidenceReporter
) {
  reporter = nextReporter;
  return () => {
    if (reporter === nextReporter) reporter = null;
  };
}

export function connectivityRequestGeneration() {
  return reporter?.requestGeneration() ?? 0;
}

export function reportHttpTransportResponse(input: {
  requestGeneration: number;
  completedAt?: number;
}) {
  reporter?.reportResponse(input);
}

export function reportHttpTransportFailure(input: { requestGeneration: number }) {
  reporter?.reportFailure({ kind: "transport", ...input });
}

export function reportHttpRequestDeadline(input: { requestGeneration: number }) {
  reporter?.reportFailure({ kind: "deadline", ...input });
}
