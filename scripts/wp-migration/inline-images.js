const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const WP_HOST_RE = /https:\/\/taikhoantenhat\.com\/wp-content\/uploads\/[^\s"'<>)]+/g;

function extractWpImageUrls(html) {
  if (!html) return [];
  const matches = String(html).match(WP_HOST_RE) || [];
  return Array.from(new Set(matches));
}

function rewriteImageSrcs(html, urlMap) {
  if (!html) return '';
  return String(html).replace(/src=("|')(https:\/\/taikhoantenhat\.com\/wp-content\/uploads\/[^"']+)\1/g,
    (full, q, url) => {
      const replacement = urlMap.get(url);
      return replacement ? `src=${q}${replacement}${q}` : full;
    });
}

module.exports = { extractWpImageUrls, rewriteImageSrcs };
