# TMA Smart Product Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cấp tìm kiếm sản phẩm trên TMA để xếp hạng theo độ liên quan, tìm được nội dung/biến thể, hỗ trợ tiếng Việt không dấu, lỗi gõ nhẹ và gợi ý gần nghĩa.

**Architecture:** Thêm một search service thuần JavaScript để chuẩn hóa và chấm điểm dữ liệu catalog lấy trực tiếp từ SQLite. Public API mới trả riêng kết quả mạnh và gợi ý; các bề mặt TMA dùng chung endpoint và helper tạo URL.

**Tech Stack:** Node.js 22, Express 4, better-sqlite3, sanitize-html, Next.js 16 App Router, React 19, TanStack Query 5, TypeScript.

## Global Constraints

- Không dùng dịch vụ AI, search provider, dependency tìm kiếm hoặc bảng search index mới.
- Không thay đổi hành vi `GET /products` khi không dùng smart search.
- Chỉ tìm sản phẩm active, không archive và biến thể active.
- Chuỗi giao diện mới phải nằm trong `web/src/i18n/vi.ts`.
- `useSearchParams` phải nằm dưới `Suspense` để production build Next.js 16 không lỗi prerender.
- Không gửi Telegram message; test API phải tự dọn fixture và không để dữ liệu test trong runtime DB.
- Trước khi kết thúc phải chạy purge theo thứ tự dry-run rồi `--apply`; không stage DB hoặc backup.

---

### Task 1: Search Service Có Trọng Số

**Files:**
- Create: `src/services/productSearchService.js`
- Create: `tests/services/productSearchService.test.js`

**Interfaces:**
- Consumes: candidate `{ product, variants }`, trong đó `product` là row từ `productListRows` và `variants` chỉ chứa biến thể active.
- Produces:
  - `normalizeSearchText(value): string`
  - `searchProductCandidates(candidates, query, options): { results, suggestions, total }`
  - match item `{ product, score, matchLabel }`

- [ ] **Step 1: Viết test fail cho chuẩn hóa và ranking trực tiếp**

```js
test('tìm không dấu ưu tiên tên sản phẩm hơn nội dung', () => {
  const output = searchProductCandidates([
    candidate({ id: 1, name: 'Kiểm tra đạo văn Quetext' }),
    candidate({ id: 2, name: 'Công cụ học tập', long_description: '<p>Kiểm tra đạo văn</p>' }),
  ], 'kiem tra dao van');

  assert.deepEqual(output.results.map((item) => item.product.id), [1, 2]);
});
```

Thêm các test độc lập cho tên biến thể, nội dung dài/hướng dẫn, loại biến thể inactive ở lớp caller fixture, và không dấu `đ → d`.

- [ ] **Step 2: Chạy test và xác nhận RED**

Run:

```bash
node --test tests/services/productSearchService.test.js
```

Expected: FAIL vì module `productSearchService` chưa tồn tại.

- [ ] **Step 3: Cài đặt chuẩn hóa và direct score tối thiểu**

`normalizeSearchText` phải dùng `sanitize-html` với `allowedTags: []`, Unicode NFD, bỏ `\p{M}`, đổi `đ` thành `d`, thay dấu phân cách bằng khoảng trắng và gộp whitespace.

Trọng số giảm dần theo:

```js
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
```

Tên khớp chính xác/nguyên cụm nhận bonus. Một query nhiều token chỉ là kết quả mạnh khi khớp nguyên cụm hoặc mọi token xuất hiện trực tiếp trong các trường.

- [ ] **Step 4: Chạy test direct score và xác nhận GREEN**

Run:

```bash
node --test tests/services/productSearchService.test.js
```

Expected: PASS các test direct matching.

- [ ] **Step 5: Viết test fail cho fuzzy, synonym và dedupe**

```js
test('lỗi gõ nhẹ chỉ xuất hiện trong gợi ý', () => {
  const output = searchProductCandidates([
    candidate({ id: 1, name: 'Tài khoản Netflix Premium' }),
  ], 'netfix');

  assert.deepEqual(output.results, []);
  assert.deepEqual(output.suggestions.map((item) => item.product.id), [1]);
});
```

Thêm test `check dao van`/`plagiarism`, giới hạn edit distance theo độ dài token và một product không nằm ở cả hai nhóm.

- [ ] **Step 6: Chạy test fuzzy và xác nhận RED**

Run:

```bash
node --test tests/services/productSearchService.test.js
```

Expected: FAIL vì chưa có fuzzy/synonym suggestions.

- [ ] **Step 7: Cài đặt suggestions tối thiểu**

Thêm nhóm synonym cố định từ spec. Dùng Levenshtein hai hàng để so token tên sản phẩm/tên biến thể/danh mục; không fuzzy token dưới 4 ký tự. Synonym/fuzzy chỉ tạo suggestion và không được trộn vào `results`.

- [ ] **Step 8: Chạy toàn bộ test service**

Run:

```bash
node --test tests/services/productSearchService.test.js
```

Expected: PASS, không warning.

### Task 2: Public Search API

**Files:**
- Modify: `src/api/routes/public.js`
- Create: `tests/api/public-product-search.test.js`

**Interfaces:**
- Consumes: `searchProductCandidates` từ Task 1 và `shapePublicProductList` hiện tại.
- Produces: `GET /api/v1/products/search?q=&category=&priceMin=&priceMax=&sort=&limit=&suggestionLimit=`.

- [ ] **Step 1: Viết API tests fail**

Tạo fixture category, product, active/inactive variants và cleanup bằng `t.after`. Kiểm tra:

```js
assert.equal(invalid.status, 400);
assert.equal(invalid.json.error.code, 'INVALID_SEARCH_QUERY');
assert.deepEqual(Object.keys(valid.json.data).sort(), ['results', 'suggestions', 'total']);
assert.equal(valid.json.data.results[0].name, productName);
```

Thêm test category filter, price filter, product inactive/archive, inactive variant và `limit`/`suggestionLimit`.

- [ ] **Step 2: Chạy API tests và xác nhận RED**

Run:

```bash
node --test tests/api/public-product-search.test.js
```

Expected: FAIL với 404 hoặc route bị hiểu như slug `search`.

- [ ] **Step 3: Cài đặt route trước `/products/:slug`**

Route:

1. validate query dài 2-100 ký tự;
2. clamp `limit` về `1..100`, `suggestionLimit` về `0..20`;
3. tái sử dụng điều kiện active/archive, category và price của `/products`;
4. lấy active variants cho tập candidate rồi group theo `product_id`;
5. gọi service;
6. shape DTO, thêm `matchLabel`, áp dụng explicit sort cho `results`, cắt limit;
7. trả `{ results, suggestions, total }`.

Không trả rich content trong DTO.

- [ ] **Step 4: Chạy service + API tests**

Run:

```bash
node --test tests/services/productSearchService.test.js tests/api/public-product-search.test.js
```

Expected: PASS.

### Task 3: Shared Frontend Search Contract

**Files:**
- Create: `web/src/lib/smartProductSearch.ts`
- Modify: `web/src/i18n/vi.ts`
- Create: `tests/web/smartProductSearch.test.mjs`

**Interfaces:**
- Produces:
  - `SmartSearchItem extends ProductSummary` ở nơi sử dụng với `matchLabel?: string`;
  - `SmartSearchResponse<T> = { results: T[]; suggestions: T[]; total: number }`;
  - `buildSmartSearchPath(query, options): string`;
  - `buildAllProductsSearchHref(query): string`.

- [ ] **Step 1: Viết helper tests fail**

```js
test('buildSmartSearchPath preserves query and filters', () => {
  assert.equal(
    buildSmartSearchPath('học tiếng Anh', { category: 'hoc-tap', limit: 5, suggestionLimit: 3 }),
    '/products/search?q=h%E1%BB%8Dc+ti%E1%BA%BFng+Anh&category=hoc-tap&limit=5&suggestionLimit=3',
  );
});
```

Kiểm tra href `/san-pham?q=...` và bỏ option rỗng.

- [ ] **Step 2: Chạy helper tests và xác nhận RED**

Run:

```bash
node --test tests/web/smartProductSearch.test.mjs
```

Expected: FAIL vì helper chưa tồn tại.

- [ ] **Step 3: Cài đặt helper và copy i18n**

Thêm các chuỗi dưới `t.catalog`: `searchResults`, `searchSuggestions`, `searchViewAll`, `searchLoading`, `searchNoResults`, `searchRelated`.

- [ ] **Step 4: Chạy helper tests và xác nhận GREEN**

Run:

```bash
node --test tests/web/smartProductSearch.test.mjs
```

Expected: PASS.

### Task 4: SearchBox Dropdown Thông Minh

**Files:**
- Modify: `web/src/app/(miniapp)/components/SearchBox.tsx`
- Modify: `web/src/app/(miniapp)/components/ProductCard.tsx`
- Modify: `tests/web/smartProductSearch.test.mjs`

**Interfaces:**
- `SearchBox` nhận thêm optional `category?: string`.
- Query preview dùng `buildSmartSearchPath(debounced, { category, limit: 5, suggestionLimit: 3 })`.

- [ ] **Step 1: Thêm static behavior tests fail**

Đọc source `SearchBox.tsx` và assert endpoint helper, hai section key i18n, `matchLabel`, loading/empty state và `buildAllProductsSearchHref`.

- [ ] **Step 2: Chạy test và xác nhận RED**

Run:

```bash
node --test tests/web/smartProductSearch.test.mjs
```

Expected: FAIL vì component còn gọi `/products?q=`.

- [ ] **Step 3: Cài đặt dropdown**

Giữ debounce 200 ms. Hiển thị section **Kết quả** và **Có thể bạn đang tìm** riêng, cùng ảnh/tên/giá/match label. Luôn render loading hoặc empty state khi dropdown mở với query hợp lệ. Thêm hàng lệnh **Xem tất cả kết quả** ở cuối.

- [ ] **Step 4: Chạy frontend helper/static tests**

Run:

```bash
node --test tests/web/smartProductSearch.test.mjs
```

Expected: PASS.

### Task 5: Trang Catalog Và Danh Mục

**Files:**
- Create: `web/src/app/(miniapp)/components/SmartSearchCatalogResults.tsx`
- Modify: `web/src/app/(miniapp)/san-pham/page.tsx`
- Modify: `web/src/app/(miniapp)/danh-muc/[slug]/page.tsx`
- Modify: `tests/web/smartProductSearch.test.mjs`

**Interfaces:**
- `SmartSearchCatalogResults` nhận `{ results, suggestions, isLoading }`.
- `/san-pham` dùng smart endpoint khi query trim dài ít nhất 2; nếu không, dùng `/products` như hiện tại.
- Trang danh mục truyền `category` cho cả `SearchBox` và smart endpoint.

- [ ] **Step 1: Viết static integration tests fail**

Kiểm tra:

- `/san-pham` dùng `useSearchParams` trong content component và có `Suspense` ở page wrapper;
- cả hai trang gọi `buildSmartSearchPath`;
- trang danh mục truyền `category={params.slug}`;
- component kết quả render lưới chính và section gợi ý riêng.

- [ ] **Step 2: Chạy test và xác nhận RED**

Run:

```bash
node --test tests/web/smartProductSearch.test.mjs
```

Expected: FAIL vì các trang còn gọi `/products?q=`.

- [ ] **Step 3: Cài đặt catalog integration**

Tách `AllProductsContent` để hook `useSearchParams` nằm dưới `<Suspense>`. Khởi tạo query từ `searchParams.get('q')`. Dùng hai React Query với `enabled` đối nghịch để không gọi cả API catalog và smart search cùng lúc.

Khi smart search active, subtitle dùng `total`; component kết quả hiển thị empty state chỉ khi cả hai nhóm rỗng. Explicit filter/sort tiếp tục được gửi vào search path.

- [ ] **Step 4: Chạy frontend tests**

Run:

```bash
node --test tests/web/smartProductSearch.test.mjs
```

Expected: PASS.

### Task 6: Verification Và Dọn Dữ Liệu

**Files:**
- Verify only; không tạo fixture lâu dài.

- [ ] **Step 1: Chạy focused tests**

```bash
node --test tests/services/productSearchService.test.js tests/api/public-product-search.test.js tests/web/smartProductSearch.test.mjs
```

- [ ] **Step 2: Chạy lint và production build**

```bash
cd web && npm run lint
cd web && npm run build
```

- [ ] **Step 3: Chạy purge bắt buộc**

```bash
node scripts/purge-test-data.js
node scripts/purge-test-data.js --apply
```

Xác nhận counts test target bằng 0 và không stage `data/shop.db`/backup.

- [ ] **Step 4: Rà soát diff**

```bash
git diff --check
git status --short
git diff -- src/services/productSearchService.js src/api/routes/public.js web/src/app/\(miniapp\)/components/SearchBox.tsx web/src/app/\(miniapp\)/components/SmartSearchCatalogResults.tsx web/src/app/\(miniapp\)/san-pham/page.tsx web/src/app/\(miniapp\)/danh-muc/\[slug\]/page.tsx web/src/lib/smartProductSearch.ts web/src/i18n/vi.ts tests/services/productSearchService.test.js tests/api/public-product-search.test.js tests/web/smartProductSearch.test.mjs
```

Đối chiếu từng yêu cầu trong spec, xác nhận không có Telegram send và không có file ngoài scope.
