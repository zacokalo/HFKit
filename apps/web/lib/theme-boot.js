// Applies the stored theme before first paint. Loaded as a classic blocking
// script in <head> on every page, because a module script runs after the
// first frame and the page would flash the default theme first.
//
// Must agree with lib/theme.mjs on the storage key and the fallback. It is
// kept to the minimum that avoids the flash; everything else lives there.
(function () {
  var t = 'auto';
  try { t = localStorage.getItem('hfkit.theme') || 'auto'; } catch (e) { /* private mode */ }
  if (t !== 'field-dark' && t !== 'field-light' && t !== 'night-ops') {
    t = matchMedia('(prefers-color-scheme: light)').matches ? 'field-light' : 'field-dark';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
