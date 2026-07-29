const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

const importedSlugs = [
  'turnitin',
  'nang-cap-turboscribe-unlimited-gia-re',
  'tai-khoan-meitu-svip-cap-san',
  'tai-khoan-iqiyi-cao-cap-gia-re',
  'tai-khoan-medium-premium-ga-re',
  'goi-nang-cap-figma-education-chinh-chu',
  'goi-nang-cap-jetbrains-student-pack',
  'tool-semrush-guru-package-trends',
  'tai-khoan-blinkist-premium-gia-re',
  'tai-khoan-gauth-ai-plus-gia-re',
  'mua-khoa-hoc-udemy-gift-course-gia-re',
  'goi-nang-cap-kahoot-plus-chinh-chu',
  'tai-khoan-originality-kiem-tra-ai',
  'tai-khoa-hoc-udemy-coursera-linkedin',
  'tai-khoan-oreilly-online-learning',
  'tai-khoan-hma-vpn-hide-my-ass',
  'tai-khoan-github-copilot-pro-tro-ly-lap-trinh-ai',
  'tai-khoan-chatgpt-go-gpt5-gia-re',
  'tai-khoan-beautiful-ai-tao-slide',
  'nang-cap-tai-khoan-quizlet-plus',
  'tai-tai-lieu-bao-cao-kinh-te',
];

test('Subhub import keeps product short descriptions within admin validation limit', () => {
  const rows = db.prepare(`
    SELECT slug, length(description) AS description_length
    FROM products
    WHERE slug IN (${importedSlugs.map(() => '?').join(',')})
  `).all(...importedSlugs);

  assert.strictEqual(rows.length, importedSlugs.length);
  const tooLong = rows.filter((row) => row.description_length > 500);
  assert.deepStrictEqual(tooLong, []);
});
