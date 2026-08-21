import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode
} from "react";
import { AppState } from "react-native";
import {
  getConnectivitySnapshot,
  refreshConnectivity,
  startConnectivityMonitor,
  subscribeConnectivity
} from "./connectivityMonitor";
import type { ConnectivityStatus } from "./connectivityState";

export type ConnectivityContextValue = {
  status: ConnectivityStatus;
  reconnectEpoch: number;
  reconnectNoticeId: number | null;
  isOffline: boolean;
  isOnline: boolean;
};

const ConnectivityContext = createContext<ConnectivityContextValue | null>(null);

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivitySnapshot
  );

  useEffect(() => startConnectivityMonitor(), []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshConnectivity().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, []);

  const value = useMemo<ConnectivityContextValue>(() => ({
    status: snapshot.status,
    reconnectEpoch: snapshot.reconnectEpoch,
    reconnectNoticeId: snapshot.reconnectNoticeId,
    isOffline: snapshot.status === "offline",
    isOnline: snapshot.status === "online"
  }), [
    snapshot.reconnectEpoch,
    snapshot.reconnectNoticeId,
    snapshot.status
  ]);

  return createElement(ConnectivityContext.Provider, { value }, children);
}

export function useConnectivity() {
  const value = useContext(ConnectivityContext);
  if (!value) {
    throw new Error("useConnectivity must be used within ConnectivityProvider");
  }
  return value;
}
