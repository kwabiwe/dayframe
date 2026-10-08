import { Redirect } from "expo-router";

// The Play orb's tab slot is disabled and never selected; a deep link here lands on Today.
export default function PlayOrbSlot() {
  return <Redirect href="/today" />;
}
