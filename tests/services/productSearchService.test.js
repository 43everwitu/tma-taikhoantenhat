const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeSearchText,
  searchProductCandidates,
} = require('../../src/services/productSearchService');

function candidate(product = {}, variants = []) {
  return {
    product: {
      id: product.id ?? Math.floor(Math.random() * 100000),
      name: product.name || '',
      slug: product.slug || '',
      category_name: product.category_name || '',
      description: product.description || '',
      long_description: product.long_description || '',
      usage_instructions: product.usage_instructions || '',
      sort_order: product.sort_order || 0,
      price: product.price || 100000,
      variant_min: product.variant_min ?? null,
      variant_max: product.variant_max ?? null,
      created_at: product.created_at || '2026-01-01 00:00:00',
    },
    variants,
  };
}

test('normalizeSearchText loại bỏ HTML, dấu tiếng Việt và ký tự phân cách', () => {
  assert.equal(
    normalizeSearchText('<p>Kiểm&nbsp;tra Đạo-văn &amp; AI</p>'),
    'kiem tra dao van ai',
  );
});

test('tìm không dấu ưu tiên tên sản phẩm hơn nội dung', () => {
  const output = searchProductCandidates([
    candidate({ id: 1, name: 'Kiểm tra đạo văn Quetext' }),
    candidate({
      id: 2,
      name: 'Công cụ học tập',
      long_description: '<p>Hỗ trợ kiểm tra đạo văn</p>',
    }),
  ], 'kiem tra dao van');

  assert.deepEqual(output.results.map((item) => item.product.id), [1, 2]);
  assert.equal(output.total, 2);
});

test('tìm theo tên biến thể trả về sản phẩm cha và nhãn khớp', () => {
  const output = searchProductCandidates([
    candidate(
      { id: 3, name: 'Nâng cấp Notion' },
      [{ id: 31, name: 'Notion Business có AI', description: '', is_active: 1 }],
    ),
  ], 'business co ai');

  assert.deepEqual(output.results.map((item) => item.product.id), [3]);
  assert.equal(output.results[0].matchLabel, 'Khớp biến thể: Notion Business có AI');
});

test('tìm được từ khóa chỉ có trong hướng dẫn sử dụng', () => {
  const output = searchProductCandidates([
    candidate({
      id: 4,
      name: 'Tài khoản dịch vụ',
      usage_instructions: '<p>Đăng nhập bằng mã QR trên TV.</p>',
    }),
  ], 'ma qr tren tv');

  assert.deepEqual(output.results.map((item) => item.product.id), [4]);
  assert.equal(output.results[0].matchLabel, 'Khớp nội dung sản phẩm');
});

test('lỗi gõ nhẹ chỉ xuất hiện trong gợi ý', () => {
  const output = searchProductCandidates([
    candidate({ id: 5, name: 'Tài khoản Netflix Premium' }),
  ], 'netfix');

  assert.deepEqual(output.results, []);
  assert.deepEqual(output.suggestions.map((item) => item.product.id), [5]);
  assert.equal(output.suggestions[0].matchLabel, 'Gần với từ khóa');
});

test('từ đồng nghĩa tạo gợi ý nhưng không lấn kết quả trực tiếp', () => {
  const output = searchProductCandidates([
    candidate({ id: 6, name: 'Quetext', description: 'Plagiarism checker chuyên nghiệp' }),
    candidate({ id: 7, name: 'Kiểm tra đạo văn trực tiếp' }),
  ], 'dao van');

  assert.deepEqual(output.results.map((item) => item.product.id), [7]);
  assert.deepEqual(output.suggestions.map((item) => item.product.id), [6]);
});

test('một sản phẩm không xuất hiện đồng thời ở kết quả và gợi ý', () => {
  const output = searchProductCandidates([
    candidate({
      id: 8,
      name: 'Proton VPN Plus',
      description: 'Dịch vụ mạng riêng ảo',
    }),
  ], 'vpn');

  assert.deepEqual(output.results.map((item) => item.product.id), [8]);
  assert.deepEqual(output.suggestions, []);
});

test('substring ngắn không được kích hoạt nhóm từ đồng nghĩa', () => {
  const output = searchProductCandidates([
    candidate({ id: 9, name: 'Quetext', description: 'Plagiarism checker' }),
  ], 'an');

  assert.deepEqual(output.results, []);
  assert.deepEqual(output.suggestions, []);
});
