# Entry sheet: suggestion tap froze the app (11 Oct 2026)

Status: open, needs a device reproduction. One related defect is fixed with the audit fix for UIA-053; the incident itself is not explained.

## Report
The UI audit on 10 Oct (simulator) saw this once:
1. Today › Start a block, then tap a row in the entry sheet's suggestions right away.
2. The sheet disappeared and the suggestion was not applied: the live block stayed "No activity".
3. The keyboard stayed up, and the app stopped taking touches while the timer kept running. Relaunching fixed it.

The same tap in Add past time worked.

## Verified from the code
- **A suggestion tapped right after a start could be dropped (fixed).**
  - In running mode, the sheet saves a suggestion through `applyRunningTimerSuggestion` (`DayframeDashboard.tsx`), which compared the sheet's entry id strictly with the dashboard's.
  - Right after a start, the sheet can still hold the optimistic id while the dashboard has already swapped in the server id. The tap was then rejected, and the sheet rolled the suggestion back.
  - The ids are now compared through the start's id correlation (`isSameRunningEntry`, `timerPresentation.ts`), and the save targets the dashboard's current id.
  - This explains a suggestion not being applied in that window. It is not established as the cause of the observed incident.

## Hypotheses (not verified)
- **The sheet disappearing:** coordinated dismissals end with `Keyboard.dismiss()`, so a lingering keyboard suggests another path. It does not prove one. Candidates:
  - a presentation change right after the blank start, which would make the overlay's callbacks stale;
  - an exit animation cancelled before `onDismiss`;
  - a native Modal teardown leaving the keyboard and an invisible window behind (related to the blank-keyboard issue on PR #161).
- **An unmount-time `Keyboard.dismiss()` was considered and rejected.** It would also dismiss another surface's keyboard during a close → focus hand-off (Codex review of #301). React Native's TextInput already blurs itself when it unmounts focused.

## Next step
The sheet's QA telemetry is development-only and disappears with the sheet, so it cannot be captured from a staging build. On the next staging phone build:
1. Screen-record while you start a block and tap a suggestion within about a second, before the start reaches the server. Repeat a few times, online and offline.
2. If the sheet vanishes, note whether the live block changed, whether the keyboard stayed, and whether a tab tap still works. Then export Settings › Sync help details before relaunching.

If it reproduces, add targeted logging of the sheet's dismissal path to a development build and repeat on the device.

## Closure
Close when repeated fast taps on a device always apply the suggestion and leave the sheet usable, or when a captured reproduction identifies the dismissal path and it is fixed.
