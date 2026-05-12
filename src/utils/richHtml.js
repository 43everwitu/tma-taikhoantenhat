const sanitizeHtml = require('sanitize-html');

// Tag set is the intersection of (a) what Telegram parse_mode=HTML accepts
// and (b) what the webapp will safely render. Adding tags here also requires
// updating web/src/lib/richHtml.ts.
const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'a', 'code', 'pre', 'br', 'tg-spoiler'];
const ALLOWED_ATTR = { a: ['href'] };

const SANITIZE_OPTS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTR,
  allowedSchemes: ['http', 'https'],
  // sanitize-html normalizes <br/> → <br>; both render identically on Telegram.
  selfClosing: ['br'],
  // No comments, no nested <a>.
  exclusiveFilter: (frame) => frame.tag === 'a' && (!frame.attribs.href || frame.attribs.href.trim() === ''),
};

/**
 * Strip everything outside the allowed tag set. Used on every admin write so
 * the DB never holds tags the renderers can't display.
 */
function sanitizeRich(html) {
  if (html == null) return '';
  return sanitizeHtml(String(html), SANITIZE_OPTS).trim();
}

const DESCRIPTION_TAGS = [
  'p', 'br', 'span', 'div',
  'h2', 'h3', 'h4',
  'b', 'strong', 'i', 'em', 'u', 's',
  'a',
  'ul', 'ol', 'li',
  'code', 'pre', 'blockquote',
  'img',
];
const DESCRIPTION_ATTR = {
  a: ['href', 'title', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  span: ['class'],
  div: ['class'],
};
const DESCRIPTION_OPTS = {
  allowedTags: DESCRIPTION_TAGS,
  allowedAttributes: DESCRIPTION_ATTR,
  allowedSchemes: ['http', 'https'],
  selfClosing: ['br', 'img'],
  transformTags: {
    img: (tagName, attribs) => ({
      tagName: 'img',
      attribs: { ...attribs, loading: attribs.loading || 'lazy' },
    }),
  },
};

function sanitizeDescription(html) {
  if (html == null) return '';
  return sanitizeHtml(String(html), DESCRIPTION_OPTS).trim();
}

/**
 * Convert sanitized rich HTML to Telegram-ready HTML. The sanitized form is
 * already Telegram-compatible; the only extra step is auto-linking bare URLs
 * that appear inside plain text nodes (admin may paste a link without using
 * the toolbar). URLs already inside <a href> are skipped to avoid nesting.
 */
function toTelegramHtml(html) {
  const clean = sanitizeRich(html);
  if (!clean) return '';
  // sanitize-html drops nested <a> before this runs, so the non-greedy
  // regex below only ever sees one anchor per match — safe to split on.
  const parts = clean.split(/(<a\s[^>]*>.*?<\/a>)/gi);
  const linked = parts.map(seg => {
    if (/^<a\s/i.test(seg)) return seg;
    return seg.replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/g, (m) => {
      // Trailing punctuation (".,;:!?)") is almost never part of a URL —
      // strip it from the link target but keep it as plain text after.
      const trail = m.match(/[.,;:!?)]+$/)?.[0] || '';
      const url = trail ? m.slice(0, -trail.length) : m;
      const href = url.startsWith('http') ? url : `https://${url}`;
      return `<a href="${href}">${url}</a>${trail}`;
    });
  }).join('');
  // Telegram parse_mode=HTML does not recognise <br> or <br /> — admins who
  // press Enter in the rich editor expect a visible line break, so collapse
  // the sanitiser-normalised tag back to a literal newline. Telegram renders
  // \n as a line break.
  return linked.replace(/<br\s*\/?>/gi, '\n');
}

module.exports = { sanitizeRich, sanitizeDescription, toTelegramHtml, ALLOWED_TAGS };
