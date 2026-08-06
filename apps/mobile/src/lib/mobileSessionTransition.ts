type SignedOutListener = () => void;

const signedOutListeners = new Set<SignedOutListener>();

export function publishMobileSignedOut() {
  for (const listener of [...signedOutListeners]) listener();
}

export function subscribeMobileSignedOut(listener: SignedOutListener) {
  signedOutListeners.add(listener);
  return () => {
    signedOutListeners.delete(listener);
  };
}
