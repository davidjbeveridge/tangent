export function isNavigableUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false;
  if (value === 'about:blank') return true;
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function normalizeInput(value: string, engine: 'duckduckgo' | 'google' = 'duckduckgo'): string {
  const input = value.trim().slice(0, 4096);
  if (!input || input === 'about:blank') return 'about:blank';
  if (isNavigableUrl(input)) return new URL(input).href;
  const local = /^(localhost|127(?:\.\d+){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input);
  if (local && isNavigableUrl(`http://${input}`)) return new URL(`http://${input}`).href;
  if (/^[^\s/:?#]+\.[^\s/:?#]+:\d+(?:[/?#]|$)/.test(input) && isNavigableUrl(`https://${input}`)) return new URL(`https://${input}`).href;
  const searchOperator = /^(site|filetype|intitle|inurl|before|after|related|cache):/i.test(input);
  const forbiddenScheme = /^(javascript|vbscript|data|file|blob|tangent|about|chrome|devtools|edge|shell):/i.test(input);
  if (forbiddenScheme || (!searchOperator && /^[a-z][a-z\d+.-]*:/i.test(input) && (!/\s/.test(input) || /^[a-z][a-z\d+.-]*:\/\//i.test(input)))) throw new Error('Only HTTP and HTTPS addresses are supported.');
  if (!searchOperator && !/\s/.test(input) && (/^[^/?#]+\.[^/?#]+/.test(input) || /^\[[0-9a-f:]+\]/i.test(input))) {
    const url = `https://${input}`;
    if (isNavigableUrl(url)) return new URL(url).href;
  }
  const prefix = engine === 'google' ? 'https://www.google.com/search?q=' : 'https://duckduckgo.com/?q=';
  return prefix + encodeURIComponent(input);
}

export function displayTitle(url: string): string {
  if (url === 'about:blank') return 'New tab';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'New tab'; }
}
