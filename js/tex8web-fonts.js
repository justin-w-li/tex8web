if (location.protocol !== 'file:') {
  for (const href of document.currentScript.dataset.fonts?.match(/\S+/g) ?? []) {
    document.head.append(Object.assign(document.createElement('link'),
      { rel: 'preload', as: 'font', type: 'font/woff2', crossOrigin: '', href }));
  }
}
