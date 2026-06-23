# Admin Editor Link UX Design

## Bối cảnh

Admin products đang dùng các TipTap editor:

- `RichEditorRich` cho mô tả ngắn và mô tả chi tiết sản phẩm.
- `RichEditorBasic` cho mô tả biến thể.
- `RichEditor` cho hướng dẫn sử dụng/template-style content.

Các editor hiện có thể thêm link bằng prompt, nhưng trải nghiệm không dùng được bình thường:

- Link trong vùng soạn thảo không có style rõ ràng, nên khó biết text đã được link hay chưa.
- `openOnClick: false` làm click link không mở link; đây là hợp lý khi đang edit, nhưng hiện không có UI thay thế để mở/sửa/gỡ link.
- Toolbar button dùng `onClick`; khi bôi đen text rồi bấm toolbar, editor có thể blur và selection bị mất/sai trước khi command chạy.

## Mục tiêu

- Bôi đen text rồi bấm Bold/Italic/Underline/List/Link áp dụng đúng vùng đang chọn.
- Link trong editor nhìn rõ là link.
- Khi cursor nằm trong link hoặc vùng chọn có link, admin thấy URL hiện tại và có thể:
  - Mở link trong tab mới.
  - Sửa URL.
  - Gỡ link.
- Không tự mở link khi click trong editor; click trong editor vẫn ưu tiên đặt cursor/chọn text.
- Áp dụng nhất quán cho product editor và variant editor.

## Không làm

- Không đổi backend API.
- Không đổi sanitizer hoặc render public HTML.
- Không thêm dependency mới.
- Không thay đổi flow lưu sản phẩm/biến thể.
- Không refactor toàn bộ admin products page.

## Thiết kế

### Toolbar giữ selection

Các toolbar button dùng `onMouseDown` thay vì chỉ `onClick`, gọi `event.preventDefault()` rồi chạy command. Cách này giữ focus/selection của TipTap khi admin bấm nút toolbar.

Áp dụng cho:

- `RichEditorRich.Tb`
- `RichEditorBasic.ToolbarButton`
- `RichEditor.ToolbarButton`

### Link command

Tạo helper cục bộ trong từng editor hoặc helper dùng chung tối thiểu:

- Nếu selection đang nằm trong link, `extendMarkRange('link')` trước khi set/unset link.
- Trim URL.
- Empty URL nghĩa là gỡ link.
- URL không có scheme nhưng có nội dung thì tự thêm `https://` để tránh lưu link tương đối ngoài ý muốn.

### Link popover

Khi `editor.isActive('link')`:

- Hiển thị một thanh nhỏ bên dưới toolbar hoặc ngay trên vùng editor.
- Hiển thị URL hiện tại dạng text ngắn, truncate nếu dài.
- Nút `Mở` dùng `window.open(href, '_blank', 'noopener,noreferrer')`.
- Nút `Sửa` gọi prompt link với URL hiện tại.
- Nút `Gỡ` unset link.

Không cần floating UI theo tọa độ selection để tránh thêm dependency. Thanh cố định trong khung editor đủ rõ và ít rủi ro.

### CSS editor

Thêm style cho vùng TipTap editor:

- `.ProseMirror a` có màu brand gold deep, underline, cursor pointer.
- Link active/focused có nền nhẹ để thấy đang ở trong link.
- `.admin-editor-link-popover` style nhỏ, nằm trong khung editor, không che nội dung.

## Kiểm thử

- TypeScript compile cho web.
- ESLint cho các file editor.
- Manual/DOM review nếu chạy dev:
  - Bôi đen chữ, bấm Bold không làm mất selection.
  - Bôi đen chữ, bấm Link, nhập URL, text có style link.
  - Đặt cursor trong link thấy popover URL.
  - `Mở` mở tab mới.
  - `Sửa` đổi href.
  - `Gỡ` bỏ link.

## Tiêu chí hoàn thành

- Product editor và variant editor dùng link được bình thường.
- Link có visual state rõ trong editor.
- Toolbar không làm mất selection khi áp dụng format.
- Không có lỗi TypeScript/ESLint ở các file liên quan.
