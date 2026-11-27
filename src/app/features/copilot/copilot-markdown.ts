const BINANCE_SAFE_URL_CONTROL_RE = /[\u0000-\u001f\u007f\s"'<>]/;

function isSafeHttpsMarkdownUrl(rawUrl: string): string | null {
  const unescaped = rawUrl
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
  if (!unescaped || BINANCE_SAFE_URL_CONTROL_RE.test(unescaped)) {
    return null;
  }
  try {
    const parsed = new URL(unescaped);
    if (parsed.protocol !== 'https:') {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    return parsed.toString()
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  } catch {
    return null;
  }
}

/**
 * Escapes all raw HTML first, extracts strict `https://` markdown links into safe
 * blank-target anchors (`rel="noopener noreferrer"`), and rejects `javascript:`,
 * `data:`, `http:`, or attribute-breakout payloads.
 */
export function renderSafeCopilotMarkdown(raw: string): string {
  const escaped = (raw || '')
    .replace(/\u0000/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const safeAnchors: string[] = [];
  const withLinkTokens = escaped.replace(
    /\[([^\]\n]{1,200})\]\(([^)\s]{1,1000})\)/g,
    (fullMatch, label: string, candidateHref: string) => {
      const safeHref = isSafeHttpsMarkdownUrl(candidateHref);
      if (!safeHref) {
        return fullMatch;
      }
      const token = `\u0000LINK_${safeAnchors.length}\u0000`;
      safeAnchors.push(
        `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="copilot-md-link">${label}</a>`,
      );
      return token;
    },
  );

  const formatted = withLinkTokens
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br />');

  return formatted.replace(/\u0000LINK_(\d+)\u0000/g, (_m, idx) => safeAnchors[Number(idx)] ?? '');
}
