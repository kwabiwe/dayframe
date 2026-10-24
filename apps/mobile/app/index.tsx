import { Redirect, type Href } from "expo-router";

const todayTabHref = "/(tabs)/today" as Href;

// Development only: Metro started with EXPO_PUBLIC_DAYFRAME_QA_ROUTE=calendar-qa (or calendar-qa-list)
// opens that QA harness straight away, so Simulator screenshots need no deep-link prompt.
const QA_ROUTES: Record<string, Href> = {
  "calendar-qa": "/calendar-qa" as Href,
  "calendar-qa-list": "/calendar-qa?layout=list" as Href,
  "calendar-qa-question": "/calendar-qa?layout=list&check=1" as Href
};
const qaRoute = __DEV__ ? QA_ROUTES[process.env.EXPO_PUBLIC_DAYFRAME_QA_ROUTE ?? ""] ?? null : null;

export default function IndexRoute() {
  // Expo's typed-route generator does not currently include unstable-native-tabs children.
  return <Redirect href={qaRoute ?? todayTabHref} />;
}
