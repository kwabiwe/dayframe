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
import { startDurableWorkMonitor } from "./durableWorkMonitor";
import type {
  ConnectivityRecoveryStatus,
  ConnectivityStatus,
  ConnectivityTransitionSource
} from "./connectivityState";

export type ConnectivityContextValue = {
  status: ConnectivityStatus;
  reconnectEpoch: number;
  recoveryEpoch: number | null;
  recoveryStatus: ConnectivityRecoveryStatus;
  source: ConnectivityTransitionSource;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
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

  useEffect(() => {
    const stopConnectivity = startConnectivityMonitor();
    const stopDurableWork = startDurableWorkMonitor();
    return () => {
      stopDurableWork();
      stopConnectivity();
    };
  }, []);

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
    recoveryEpoch: snapshot.recoveryEpoch,
    recoveryStatus: snapshot.recoveryStatus,
    source: snapshot.source,
    isConnected: snapshot.isConnected,
    isInternetReachable: snapshot.isInternetReachable,
    isOffline: snapshot.status === "offline",
    isOnline: snapshot.status === "online"
  }), [
    snapshot.isConnected,
    snapshot.isInternetReachable,
    snapshot.reconnectEpoch,
    snapshot.recoveryEpoch,
    snapshot.recoveryStatus,
    snapshot.source,
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
