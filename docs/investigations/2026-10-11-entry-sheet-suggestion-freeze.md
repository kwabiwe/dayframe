# Entry sheet: suggestion tap froze the app (11 Oct 2026)

Status: open, needs a device reproduction. The two fixes below shipped with the audit fix for UIA-053.

## Report
The UI audit on 10 Oct (simulator) saw this once:
1. Today › Start a block, then tap a row in the entry sheet's suggestions right away.
2. The sheet disappeared and the suggestion was not applied: the live block stayed "No activity".
3. The keyboard stayed up, and the app stopped taking touches while the timer kept running. Relaunching fixed it.

The same tap in Add past time worked.

## Findings (one read-only code pass)
- **Not applied (fixed).** In running mode, a suggestion is saved through `applyRunningTimerSuggestion` (`DayframeDashboard.tsx`). Right after a start, the sheet still holds the optimistic id while the dashboard may already have swapped in the server id. The old strict id check rejected the tap, and the sheet rolled the suggestion back. The ids are now compared through the start's id correlation (`isSameRunningEntry`, `timerPresentation.ts`), and the save targets the current id.
- **Keyboard left behind (guarded).** Every coordinated dismissal ends with `Keyboard.dismiss()`. The stuck keyboard means the sheet went away without that path. The sheet already keeps its last entry while visible, and the parent only clears the presentation through the coordinated exit or on sign-out. The sheet now dismisses the keyboard when it unmounts, so a keyboard can't outlive a removed Modal whatever the path.
- **Not explained:** what made the sheet disappear. One candidate is a presentation change right after the blank start, which would make the overlay's callbacks stale. Another is an exit animation that was cancelled before `onDismiss`. The sheet's QA telemetry (`staleCallbackCount`, `dismissedCallbackCount`, `handledDismissRequestId`) would tell these apart on a reproduction.

## Next step
On the next staging phone build:
1. Start a block and tap a suggestion within about a second, before the start reaches the server. Repeat a few times, online and offline.
2. If the sheet ever vanishes, capture the sheet telemetry before relaunching.

## Closure
Close when repeated fast taps on a device always apply the suggestion and leave the sheet usable, or when a captured reproduction identifies the dismissal path and it is fixed.
