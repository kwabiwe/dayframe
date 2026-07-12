# Mobile Navigation Vignette And Motion Investigation

Date: 2026-07-11

## Reported behaviour

Real-device screenshots from TestFlight build `0.1.0 (21)` showed two related defects while navigating from Settings:

- a light border appeared around the rounded corners of dark screens;
- the source and destination screens were visibly clipped into overlapping rounded cards during the transition.

Settings sub-section state and back navigation had already been corrected in PRs #45 and #46, so this investigation preserved the route-param-only navigation model.

## Root cause

The React Native screen content used the Dayframe theme, but the surrounding native navigation container still inherited React Navigation's default light theme. The Expo app also had no native root background configured. Those light backing surfaces became visible when the current iOS native-stack transition rounded and separated its scenes.

The same transition amplified abrupt layout changes inside Settings-adjacent screens, while some local interactions used unrelated timing values or delayed scroll jumps.

## Fix

- Bind the Expo Router navigation theme to the resolved Dayframe light/dark tokens.
- Set the Expo/native root background and update it when the in-app appearance preference changes.
- Use a flat, gesture-compatible native-stack push with the transition shadow disabled.
- Respect Reduce Motion at the stack level and centralise short control/layout/sheet/screen timings.
- Preserve the latest Settings route-param navigation and native back gesture behaviour.

## Closure criteria

- Dark-mode push, pop and interactive swipe-back transitions show no white corner or edge leak.
- Light mode uses the designed light canvas instead of the dark launch/root fallback after React mounts.
- Settings index and every sub-setting still pop naturally through the native header and swipe-back gesture.
- Review and Places use the same scene background and transition behaviour.
- Reduce Motion disables route/layout animation while state changes remain understandable.
