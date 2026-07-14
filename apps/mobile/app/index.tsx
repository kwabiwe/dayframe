import { Redirect, type Href } from "expo-router";

const todayTabHref = "/(tabs)/today" as Href;

export default function IndexRoute() {
  // Expo's typed-route generator does not currently include unstable-native-tabs children.
  return <Redirect href={todayTabHref} />;
}
