const sanitizeHtml = require('sanitize-html');

const FIELD_WEIGHTS = {
  name: 160,
  variantName: 130,
  slug: 100,
  category: 90,
  description: 60,
  longDescription: 35,
  variantDescription: 35,
  usageInstructions: 20,
};

const SYNONYM_GROUPS = [
  ['đạo văn', 'plagiarism'],
  ['mạng riêng ảo', 'vpn'],
  ['học ngoại ngữ', 'học tiếng anh', 'language learning'],
  ['chỉnh ảnh', 'sửa ảnh', 'photo editor'],
  ['lưu mật khẩu', 'quản lý mật khẩu', 'password manager'],
  ['trí tuệ nhân tạo', 'ai'],
];

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, code) => {
      const normalized = code.toLowerCase();
      if (normalized.startsWith('#x')) {
        return String.fromCodePoint(parseInt(normalized.slice(2), 16));
      }
      if (normalized.startsWith('#')) {
        return String.fromCodePoint(parseInt(normalized.slice(1), 10));
      }
      return named[normalized] || entity;
    },
  );
}

function normalizeSearchText(value) {
  const plain = decodeHtmlEntities(sanitizeHtml(String(value || ''), {
    allowedTags: [],
    allowedAttributes: {},
  }));

  return plain
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const NORMALIZED_SYNONYM_GROUPS = SYNONYM_GROUPS.map((group) => (
  group.map(normalizeSearchText)
));

function uniqueTokens(value) {
  return [...new Set(value.split(' ').filter(Boolean))];
}

function buildFields(candidate) {
  const product = candidate.product;
  const fields = [
    { kind: 'name', text: product.name || '', label: '' },
    { kind: 'slug', text: product.slug || '', label: '' },
    {
      kind: 'category',
      text: product.category_name || '',
      label: product.category_name ? `Trong danh mục: ${product.category_name}` : '',
    },
    { kind: 'description', text: product.description || '', label: 'Khớp nội dung sản phẩm' },
    { kind: 'longDescription', text: product.long_description || '', label: 'Khớp nội dung sản phẩm' },
    { kind: 'usageInstructions', text: product.usage_instructions || '', label: 'Khớp nội dung sản phẩm' },
  ];

  for (const variant of candidate.variants || []) {
    if (variant.is_active === 0) continue;
    fields.push({
      kind: 'variantName',
      text: variant.name || '',
      label: variant.name ? `Khớp biến thể: ${variant.name}` : '',
    });
    fields.push({
      kind: 'variantDescription',
      text: variant.description || '',
      label: 'Khớp nội dung sản phẩm',
    });
  }

  return fields
    .map((field) => ({
      ...field,
      normalized: normalizeSearchText(field.text),
    }))
    .filter((field) => field.normalized);
}

function scoreDirect(fields, normalizedQuery) {
  const queryTokens = uniqueTokens(normalizedQuery);
  const matchedTokens = new Set();
  let score = 0;
  let phraseMatched = false;
  let bestField = null;
  let bestFieldScore = 0;

  for (const field of fields) {
    const weight = FIELD_WEIGHTS[field.kind];
    const fieldTokens = new Set(uniqueTokens(field.normalized));
    let fieldScore = 0;

    if (field.normalized === normalizedQuery) {
      fieldScore += weight * 8;
      phraseMatched = true;
    } else if (field.normalized.startsWith(`${normalizedQuery} `)) {
      fieldScore += weight * 5;
      phraseMatched = true;
    } else if (field.normalized.includes(normalizedQuery)) {
      fieldScore += weight * 4;
      phraseMatched = true;
    }

    for (const token of queryTokens) {
      if (!fieldTokens.has(token)) continue;
      matchedTokens.add(token);
      fieldScore += weight;
    }

    score += fieldScore;
    if (fieldScore > bestFieldScore) {
      bestField = field;
      bestFieldScore = fieldScore;
    }
  }

  const coverage = queryTokens.length > 0 ? matchedTokens.size / queryTokens.length : 0;
  return {
    score: score + (coverage === 1 ? 200 : 0),
    strong: score > 0 && (phraseMatched || coverage === 1),
    coverage,
    bestField,
  };
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function fuzzyLimit(token) {
  if (token.length < 4) return 0;
  return token.length >= 8 ? 2 : 1;
}

function scoreFuzzy(fields, normalizedQuery) {
  const identityTokens = uniqueTokens(
    fields
      .filter((field) => ['name', 'variantName', 'category'].includes(field.kind))
      .map((field) => field.normalized)
      .join(' '),
  );
  const queryTokens = uniqueTokens(normalizedQuery);
  if (queryTokens.length === 0 || identityTokens.length === 0) return 0;

  let score = 0;
  for (const queryToken of queryTokens) {
    const limit = fuzzyLimit(queryToken);
    if (limit === 0) return 0;
    let bestDistance = Infinity;
    for (const candidateToken of identityTokens) {
      bestDistance = Math.min(bestDistance, levenshteinDistance(queryToken, candidateToken));
      if (bestDistance === 0) break;
    }
    if (bestDistance > limit) return 0;
    score += (limit - bestDistance + 1) * 40;
  }
  return score;
}

function synonymQueries(normalizedQuery) {
  const queries = [];
  for (const group of NORMALIZED_SYNONYM_GROUPS) {
    const matched = group.some((term) => (
      normalizedQuery === term
      || ` ${normalizedQuery} `.includes(` ${term} `)
    ));
    if (!matched) continue;
    for (const term of group) {
      if (term !== normalizedQuery) queries.push(term);
    }
  }
  return [...new Set(queries)];
}

function scoreSynonyms(fields, normalizedQuery) {
  let score = 0;
  for (const synonymQuery of synonymQueries(normalizedQuery)) {
    const match = scoreDirect(fields, synonymQuery);
    if (match.strong) score = Math.max(score, Math.round(match.score / 4));
  }
  return score;
}

function directMatchLabel(field) {
  if (!field) return '';
  return field.label || '';
}

function compareDefault(left, right) {
  return (
    right.score - left.score
    || Number(left.product.sort_order || 0) - Number(right.product.sort_order || 0)
    || Number(left.product.id || 0) - Number(right.product.id || 0)
  );
}

function effectiveMinPrice(product) {
  return Number(product.variant_min ?? product.price ?? 0);
}

function effectiveMaxPrice(product) {
  return Number(product.variant_max ?? product.price ?? 0);
}

function sortResults(matches, sort) {
  if (sort === 'price_asc') {
    return matches.sort((a, b) => effectiveMinPrice(a.product) - effectiveMinPrice(b.product) || compareDefault(a, b));
  }
  if (sort === 'price_desc') {
    return matches.sort((a, b) => effectiveMaxPrice(b.product) - effectiveMaxPrice(a.product) || compareDefault(a, b));
  }
  if (sort === 'newest') {
    return matches.sort((a, b) => (
      String(b.product.created_at || '').localeCompare(String(a.product.created_at || ''))
      || Number(b.product.id || 0) - Number(a.product.id || 0)
    ));
  }
  if (sort === 'name_asc' || sort === 'name_desc') {
    const direction = sort === 'name_asc' ? 1 : -1;
    return matches.sort((a, b) => (
      direction * String(a.product.name || '').localeCompare(String(b.product.name || ''), 'vi')
      || compareDefault(a, b)
    ));
  }
  return matches.sort(compareDefault);
}

function searchProductCandidates(candidates, query, options = {}) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return { results: [], suggestions: [], total: 0 };

  const results = [];
  const suggestions = [];

  for (const candidate of candidates) {
    const fields = buildFields(candidate);
    const direct = scoreDirect(fields, normalizedQuery);
    if (direct.strong) {
      results.push({
        product: candidate.product,
        score: direct.score,
        matchLabel: directMatchLabel(direct.bestField),
      });
      continue;
    }

    const fuzzyScore = scoreFuzzy(fields, normalizedQuery);
    const synonymScore = scoreSynonyms(fields, normalizedQuery);
    const score = Math.max(fuzzyScore, synonymScore);
    if (score <= 0) continue;

    suggestions.push({
      product: candidate.product,
      score,
      matchLabel: fuzzyScore >= synonymScore
        ? 'Gần với từ khóa'
        : 'Sản phẩm liên quan',
    });
  }

  sortResults(results, options.sort || 'default');
  suggestions.sort(compareDefault);

  return {
    results,
    suggestions,
    total: results.length,
  };
}

module.exports = {
  normalizeSearchText,
  searchProductCandidates,
};
