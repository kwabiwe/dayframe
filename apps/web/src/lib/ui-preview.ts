// UI review preview (29 Oct 2026): shared by the server layout and the staging-only switch.
export const UI_PREVIEW_STORAGE_KEY = "dayframe.uiPreview";

export const UI_PREVIEW_INIT_SCRIPT =
  "try{var q=new URLSearchParams(location.search).get('ui');if(q==='next'||q==='current'){localStorage.setItem('dayframe.uiPreview',q)}if(localStorage.getItem('dayframe.uiPreview')==='next'){document.documentElement.setAttribute('data-ui','next')}}catch(e){}";

/** Staging and local development only; production never renders the switch or sets the attribute. */
export function uiPreviewEnabled() {
  return process.env.NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV === "staging" || process.env.NODE_ENV === "development";
}
