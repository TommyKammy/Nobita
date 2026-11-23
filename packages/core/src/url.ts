/**
 * Return a safe href for anchors, or null when the scheme could execute code.
 * Relative paths, fragments, http(s) and mailto are allowed.
 */
export function safeHref(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed;
  }
  try {
    const base = typeof location === 'undefined' ? 'https://nobita.invalid/' : location.href;
    const url = new URL(trimmed, base);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

/** Images may be remote, bundled relative paths, data images or blobs. */
export function safeImageSrc(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed;
  if (/^data:image\//iu.test(trimmed)) return trimmed;
  try {
    const base = typeof location === 'undefined' ? 'https://nobita.invalid/' : location.href;
    const url = new URL(trimmed, base);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'blob:') return trimmed;
  } catch {
    return null;
  }
  return null;
}
