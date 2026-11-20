/**
 * Strips HTML tags from a Shopify `body_html` field and decodes the handful
 * of entities that show up in practice, producing plain text suitable for
 * a Listing's description. This is intentionally not a full HTML parser —
 * Shopify descriptions are simple marked-up prose, not arbitrary documents.
 */
export function stripHtml(html: string): string {
  if (!html) {
    return '';
  }

  const withoutTags = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  const decoded = withoutTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  return decoded.replace(/\s+/g, ' ').trim();
}
