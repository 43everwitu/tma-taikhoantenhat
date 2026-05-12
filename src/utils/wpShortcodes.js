function unwrapCaption(html) {
  return html.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, (_, inner) => {
    const m = inner.match(/<img\b[^>]*\/?>/i);
    return m ? m[0] : '';
  });
}

function dropGallery(html) {
  return html.replace(/\[gallery\b[^\]]*\]/gi, '');
}

function stripWpShortcodes(html) {
  if (html == null) return '';
  let out = String(html);
  out = unwrapCaption(out);
  out = dropGallery(out);
  return out;
}

module.exports = { stripWpShortcodes };
