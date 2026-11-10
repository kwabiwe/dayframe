// Open portal layers, oldest first, and the page elements this module made inert. Only the newest
// dialog is interactive; the page (and any older dialog) stays inert until the last one closes
// (Codex r2 on #469). Elements made inert by someone else are left alone.
const modalStack: HTMLElement[] = [];
const isolatedByStack = new Set<HTMLElement>();

function syncModalIsolation() {
  const top = modalStack[modalStack.length - 1] ?? null;
  for (const element of [...isolatedByStack]) {
    if (top && element !== top && element.isConnected) continue;
    element.removeAttribute("inert");
    isolatedByStack.delete(element);
  }
  if (!top) return;
  for (const element of document.body.children) {
    if (!(element instanceof HTMLElement) || element === top || element.hasAttribute("inert")) continue;
    element.setAttribute("inert", "");
    isolatedByStack.add(element);
  }
}

function closeModal(layer: HTMLElement) {
  const index = modalStack.lastIndexOf(layer);
  if (index >= 0) modalStack.splice(index, 1);
  if (isolatedByStack.has(layer)) {
    // A closed layer stays inert through its own prop. One still open (React StrictMode replaying
    // the effect, or an unmount) gets back the interactivity the stack took (Codex r3 on #469).
    if (layer.getAttribute("aria-hidden") !== "true") layer.removeAttribute("inert");
    isolatedByStack.delete(layer);
  }
  syncModalIsolation();
}

export function isolateModalLayer(layer: HTMLElement) {
  modalStack.push(layer);
  syncModalIsolation();
  return () => closeModal(layer);
}
