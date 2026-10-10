// A dialog, menu, listbox or other popup is open: an expanded popup trigger or combobox (not a
// disclosure, which may stay open), or a visible popup surface. Kept-mounted popovers stay in
// the DOM while closed, hidden with aria-hidden/inert.
export function hasOpenDialog() {
  if (document.querySelector("[aria-expanded='true']:is([aria-haspopup], [aria-autocomplete])")) return true;
  return Array.from(document.querySelectorAll<HTMLElement>(
    "[role='dialog'], [role='menu'], [role='listbox'], [aria-modal='true'], dialog[open]"
  )).some((element) => !element.closest("[aria-hidden='true'], [inert], [hidden]") && element.getClientRects().length > 0);
}
