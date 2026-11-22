/**
 * Decodes HTML entities that show up in practice in Store product text:
 * the handful of named entities (`&amp;`, `&nbsp;`, ...) plus numeric
 * character references (`&#8211;`, `&#x2014;`, ...) -- WordPress/
 * WooCommerce text in particular is full of the latter (smart quotes,
 * en-/em-dashes) where Shopify text rarely has more than the named ones.
 * Used both standalone (for a title-like field with no markup to strip,
 * e.g. WooCommerce's product `name`) and as the last step of `stripHtml`
 * below.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) {
    return '';
  }

  const namedEntities: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };

  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const codePoint = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (Number.isNaN(codePoint)) {
        return match;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return namedEntities[entity.toLowerCase()] ?? match;
  });
}

/**
 * Strips HTML tags from a Store product description field (Shopify's
 * `body_html`, WooCommerce's `description`/`short_description`) and
 * decodes its entities, producing plain text suitable for a Listing's
 * description. This is intentionally not a full HTML parser -- Store
 * descriptions are simple marked-up prose, not arbitrary documents.
 */
export function stripHtml(html: string): string {
  if (!html) {
    return '';
  }

  const withoutTags = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  const decoded = decodeHtmlEntities(withoutTags);

  return decoded.replace(/\s+/g, ' ').trim();
}
