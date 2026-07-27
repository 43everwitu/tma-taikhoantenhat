import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildAllProductsSearchHref,
  buildSmartSearchPath,
  isSmartSearchQuery,
} from '../../web/src/lib/smartProductSearch.ts';

test('buildSmartSearchPath giữ query tiếng Việt và các filter có giá trị', () => {
  assert.equal(
    buildSmartSearchPath('học tiếng Anh', {
      category: 'hoc-tap',
      sort: 'price_asc',
      priceMin: 100000,
      priceMax: 500000,
      limit: 5,
      suggestionLimit: 3,
    }),
    '/products/search?q=h%E1%BB%8Dc+ti%E1%BA%BFng+Anh&category=hoc-tap&sort=price_asc&priceMin=100000&priceMax=500000&limit=5&suggestionLimit=3',
  );
});

test('buildSmartSearchPath bỏ option rỗng và trim query', () => {
  assert.equal(
    buildSmartSearchPath('  netflix  ', {
      category: '',
      sort: 'default',
      priceMin: '',
      priceMax: '',
    }),
    '/products/search?q=netflix',
  );
});

test('buildAllProductsSearchHref encode query cho trang tất cả sản phẩm', () => {
  assert.equal(
    buildAllProductsSearchHref('check đạo văn'),
    '/san-pham?q=check+%C4%91%E1%BA%A1o+v%C4%83n',
  );
});

test('isSmartSearchQuery chỉ bật với từ khóa từ hai ký tự', () => {
  assert.equal(isSmartSearchQuery(' a '), false);
  assert.equal(isSmartSearchQuery(' ai '), true);
});

test('SearchBox dùng smart endpoint và hiển thị hai nhóm kết quả', () => {
  const source = readFileSync(
    new URL('../../web/src/app/(miniapp)/components/SearchBox.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /buildSmartSearchPath/);
  assert.match(source, /buildAllProductsSearchHref/);
  assert.match(source, /t\.catalog\.searchResults/);
  assert.match(source, /t\.catalog\.searchSuggestions/);
  assert.match(source, /t\.catalog\.searchLoading/);
  assert.match(source, /t\.catalog\.searchNoResults/);
  assert.match(source, /matchLabel/);
  assert.doesNotMatch(source, /\/products\?q=/);
});

test('trang catalog và danh mục tích hợp smart search theo đúng scope', () => {
  const catalog = readFileSync(
    new URL('../../web/src/app/(miniapp)/san-pham/page.tsx', import.meta.url),
    'utf8',
  );
  const category = readFileSync(
    new URL('../../web/src/app/(miniapp)/danh-muc/[slug]/page.tsx', import.meta.url),
    'utf8',
  );
  const results = readFileSync(
    new URL('../../web/src/app/(miniapp)/components/SmartSearchCatalogResults.tsx', import.meta.url),
    'utf8',
  );
  const productCard = readFileSync(
    new URL('../../web/src/app/(miniapp)/components/ProductCard.tsx', import.meta.url),
    'utf8',
  );

  assert.match(catalog, /useSearchParams/);
  assert.match(catalog, /<Suspense/);
  assert.match(catalog, /buildSmartSearchPath/);
  assert.match(catalog, /SmartSearchCatalogResults/);
  assert.match(category, /buildSmartSearchPath/);
  assert.match(category, /category=\{params\.slug\}/);
  assert.match(category, /SmartSearchCatalogResults/);
  assert.match(results, /t\.catalog\.searchSuggestions/);
  assert.match(productCard, /p\.matchLabel/);
});
