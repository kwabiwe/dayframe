# Approved sync integration

The owner approved these exact independently reviewed heads for integration only:

| PR | Approved head |
| --- | --- |
| #188 | `90626eb3f3e9221c4b269ac66122210de1b9ffad` |
| #189 | `ab745d4e4a7e7d3f13cac022c3cc11db25529718` |
| #190 | `5b3456f8f9fb2a0585ee312bec8e32134f335c7f` |

All GitHub checks, including clean unsigned Simulator builds, finished successfully on those heads before integration began. Integration commits preserve each approved head in history. The PR chain is #188 → #189 → #190; no PR is merged into main.

## Semantic overlap resolutions

- Server ingestion combines the bounded transaction/client and phase ownership from #188 with #190's source-decision inspection. Health/commute ownership is locked once before effects. Duplicate receipts use the same bounded executor and retain prior-ignore/unavailable-resolution dispositions. New-entry acknowledgements retain their canonical entry ID and Review references.
- Every later Sleep revision uses the shared owner-scoped `recordHealthSleepResolution` helper inside the bounded transaction. This preserves the third-phase fix without two competing link writes.
- Mobile queue requests retain both the captured Health backend/workspace/user check and session/cancellation guards. Both cancellation and durable-acknowledgement regressions remain present. The automatically combined Health tests had duplicate account mocks with different equality semantics; they now use one captured-account fixture and the real account comparison helper, including when the captured owner also carries backend identity.
- Health capture retains the journal implementation, which carries caller cancellation, session ownership and deadlines through query, checkpoint commit and handoff. The earlier direct-enqueue/global-anchor implementation is superseded; its cancellation behavior is preserved by the journal guards. Manual Sync now retains its single follow-up pass and independent pipelines.
- npm dependencies retain both Expo Constants (build identity) and Expo Crypto (immutable journal fingerprints). The npm lock is regenerated from the combined manifests. CocoaPods is regenerated with 1.16.2; Expo Crypto remains in the graph, and the three prebuilt path checksums are verified rather than selecting a conflicting graph wholesale.
- Documentation retains the server, mobile and Health contracts/checklists together, uses local evidence links now present in the combined tree, and records integration approval separately from release approval. Historical incident notes remain historical evidence.

## Validation and deployment boundaries

The combined validation covers all workspace tests/typechecks, lint, web build, docs, brand assets, Review/Location SQLite checks and real PostgreSQL transaction/Health/Review/Location/Stop validators. GitHub runs base and ordered PostGIS profiles plus a clean unsigned iOS Simulator build on the combined tree. Exact result counts, source SHA, deployment ID and authenticated staging identity are recorded in the PR description after validation and deployment.

The required resolution-link migration is already applied to staging and must not be reapplied for this integration. Promotion targets only `dayframe-staging.vercel.app`, after the exact combined Preview is Ready and its staging identity is verified. Production, production migration, PR merge and TestFlight upload remain unauthorised. Unit/Simulator results and synthetic staging fixtures do not establish the missing historical Health/commute source evidence or physical-iPhone recovery.
