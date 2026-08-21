type ConnectivityEvidenceReporter = {
  requestGeneration: () => number;
  reportResponse: (input: {
    requestGeneration: number;
    completedAt?: number;
  }) => void;
  reportFailure: () => void;
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

export function reportHttpTransportFailure() {
  reporter?.reportFailure();
}
