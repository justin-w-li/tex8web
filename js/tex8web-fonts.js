// tex8web: inline and first in <head> (page.lua), so that the fonts in data-fonts are
// preloaded as the parser reaches this. Not from a file: Safari refuses the preloads there
// (no CORS headers to pass), and its @font-face loads reuse the refusals, so no face loads.
if (location.protocol !== 'file:') {
  for (const href of document.currentScript.dataset.fonts?.match(/\S+/g) ?? []) {
    document.head.append(Object.assign(document.createElement('link'),
      { rel: 'preload', as: 'font', type: 'font/woff2', crossOrigin: '', href }));
  }
}
