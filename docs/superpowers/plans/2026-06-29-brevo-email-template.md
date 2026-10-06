# Brevo Email Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a modern, responsive Brevo HTML email template that announces Taikhoantenhat Shop's new Telegram purchasing system and drives customers to `@taikhoantenhat_bot`.

**Architecture:** Keep this as a static email artifact: one HTML file plus one public image asset under the existing `/uploads` static route. Use table-based email layout, inline styles, minimal responsive CSS, and absolute URLs so Brevo can paste/send the template directly.

**Tech Stack:** Static HTML email, Brevo template variables, ImageMagick `convert`, existing Express `/uploads` static hosting from `data/uploads`.

---

## File Structure

- Modify: `taikhoantenhat_brevo_email_template.html`  
  Full Brevo-compatible HTML email. Contains all copy, responsive table layout, CTA links, footer variables, and the absolute image URL.
- Create: `data/uploads/email/taikhoantenhat-system-new.png`  
  Optimized image derived from `image.png`. This file is a runtime upload asset and must not be committed unless the deployment process intentionally tracks public uploads.
- Read-only source: `image.png`  
  User-provided banner source for the hero visual.

---

### Task 1: Prepare Email Image Asset

**Files:**
- Create: `data/uploads/email/taikhoantenhat-system-new.png`
- Read: `image.png`

- [ ] **Step 1: Create the email upload directory**

```bash
mkdir -p data/uploads/email
```

Expected: `data/uploads/email` exists.

- [ ] **Step 2: Generate a lighter PNG from the provided banner**

```bash
convert image.png -resize 760x -strip -quality 85 data/uploads/email/taikhoantenhat-system-new.png
```

Expected: command exits with code `0`.

- [ ] **Step 3: Verify the generated asset**

```bash
file data/uploads/email/taikhoantenhat-system-new.png
du -h data/uploads/email/taikhoantenhat-system-new.png
```

Expected:

```text
data/uploads/email/taikhoantenhat-system-new.png: PNG image data
```

The file size should be smaller than `image.png`.

---

### Task 2: Replace Brevo Email Template

**Files:**
- Modify: `taikhoantenhat_brevo_email_template.html`

- [ ] **Step 1: Replace the template with the final email HTML**

Use `apply_patch` to replace the entire content of `taikhoantenhat_brevo_email_template.html` with:

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>Taikhoantenhat Shop - Hệ thống mua hàng mới</title>
  <style>
    @media only screen and (max-width: 640px) {
      .container { width: 100% !important; }
      .px { padding-left: 20px !important; padding-right: 20px !important; }
      .stack { display: block !important; width: 100% !important; }
      .hero-title { font-size: 34px !important; line-height: 1.1 !important; }
      .hero-copy { font-size: 17px !important; }
      .btn { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
      .mobile-gap { padding-top: 20px !important; }
      .hide-mobile { display: none !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#eef1f4; font-family:Arial, Helvetica, sans-serif; color:#1c222b;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
    Hệ thống mua hàng mới trên Telegram: mua nhanh, nhận key tự động, ưu đãi 10% tối đa 100.000đ.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef1f4;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" class="container" width="640" cellspacing="0" cellpadding="0" border="0" style="width:640px; max-width:640px; background:#ffffff; border-radius:18px; overflow:hidden; box-shadow:0 12px 34px rgba(28,34,43,0.12);">

          <tr>
            <td class="px" style="padding:22px 32px; background:#0b0d10;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="left" style="font-size:0;">
                    <span style="display:inline-block; vertical-align:middle; width:42px; height:42px; border-radius:14px; background:#ffc200; color:#0b0d10; font-size:25px; line-height:42px; text-align:center;">😎</span>
                    <span style="display:inline-block; vertical-align:middle; padding-left:12px; color:#ffffff; font-size:20px; line-height:1.15; font-weight:800;">
                      TAIKHOANTENHAT <span style="color:#ffc200;">SHOP</span>
                    </span>
                  </td>
                  <td align="right" class="hide-mobile" style="color:#ffc200; font-size:13px; line-height:1.4; font-weight:700;">
                    Mini App Telegram
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:34px 32px 30px 32px; background:#0b0d10; background-image:linear-gradient(135deg,#0b0d10 0%,#171b21 56%,#3a2a00 100%);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="stack" width="56%" valign="middle" style="padding-right:18px;">
                    <div style="display:inline-block; border:1px solid rgba(255,194,0,0.6); border-radius:999px; padding:8px 13px; color:#ffffff; font-size:14px; line-height:1.2; font-weight:700;">
                      Ưu đãi riêng cho khách cũ
                    </div>
                    <h1 class="hero-title" style="margin:18px 0 12px 0; color:#ffffff; font-size:42px; line-height:1.06; font-weight:900; letter-spacing:0;">
                      Hệ thống<br><span style="color:#ffc200;">mua hàng mới</span>
                    </h1>
                    <p class="hero-copy" style="margin:0 0 20px 0; color:#f2f4f7; font-size:19px; line-height:1.48; font-weight:600;">
                      Mua tài khoản số ngay trên Telegram, nhận key tự động và theo dõi đơn hàng dễ dàng.
                    </p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px 0;">
                      <tr>
                        <td style="background:#ffc200; color:#0b0d10; font-size:17px; font-weight:900; padding:13px 16px; border-radius:12px 0 0 12px;">
                          GIẢM 10%
                        </td>
                        <td style="background:#ffffff; color:#1c222b; font-size:16px; font-weight:800; padding:13px 16px; border-radius:0 12px 12px 0;">
                          Tối đa <span style="color:#d71920; font-size:22px; font-weight:900;">100.000đ</span>
                        </td>
                      </tr>
                    </table>
                    <a class="btn" href="https://t.me/taikhoantenhat_bot" target="_blank" style="display:inline-block; background:#ffc200; color:#0b0d10; text-decoration:none; font-size:18px; line-height:1.2; font-weight:900; padding:16px 28px; border-radius:12px; box-shadow:0 9px 20px rgba(255,194,0,0.32);">
                      MỞ BOT NGAY
                    </a>
                    <div style="margin-top:12px; color:#d9dde3; font-size:15px; line-height:1.4; font-weight:700;">
                      @taikhoantenhat_bot
                    </div>
                  </td>
                  <td class="stack mobile-gap" width="44%" valign="middle" align="center">
                    <img src="https://tenhatshop.taikhoantenhat.me/uploads/email/taikhoantenhat-system-new.png" width="248" alt="Hệ thống mua hàng mới của Taikhoantenhat Shop trên Telegram" style="display:block; width:100%; max-width:248px; height:auto; border:0; border-radius:16px;">
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:28px 32px 8px 32px; background:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="stack" width="33.33%" align="center" style="padding:10px 8px 18px 8px;">
                    <div style="width:48px; height:48px; border-radius:16px; background:#fff4bf; color:#0b0d10; font-size:26px; line-height:48px; text-align:center;">✈</div>
                    <div style="font-size:15px; line-height:1.35; font-weight:900; color:#1c222b; margin-top:9px;">Mua trên Telegram</div>
                    <div style="font-size:13px; line-height:1.45; color:#667085; margin-top:4px;">Không cần vào web</div>
                  </td>
                  <td class="stack" width="33.33%" align="center" style="padding:10px 8px 18px 8px;">
                    <div style="width:48px; height:48px; border-radius:16px; background:#fff4bf; color:#0b0d10; font-size:26px; line-height:48px; text-align:center;">⚡</div>
                    <div style="font-size:15px; line-height:1.35; font-weight:900; color:#1c222b; margin-top:9px;">Giao key tự động</div>
                    <div style="font-size:13px; line-height:1.45; color:#667085; margin-top:4px;">Nhanh sau thanh toán</div>
                  </td>
                  <td class="stack" width="33.33%" align="center" style="padding:10px 8px 18px 8px;">
                    <div style="width:48px; height:48px; border-radius:16px; background:#fff4bf; color:#0b0d10; font-size:26px; line-height:48px; text-align:center;">✓</div>
                    <div style="font-size:15px; line-height:1.35; font-weight:900; color:#1c222b; margin-top:9px;">Bảo hành toàn thời hạn</div>
                    <div style="font-size:13px; line-height:1.45; color:#667085; margin-top:4px;">Yên tâm sử dụng</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:18px 32px 10px 32px; background:#ffffff;">
              <h2 style="margin:0 0 14px 0; color:#1c222b; font-size:24px; line-height:1.25; font-weight:900;">
                Cách mua hàng trong 3 bước
              </h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:0 6px 14px 0;">
                    <div style="background:#fff9df; border:1px solid #ffe58a; border-radius:14px; padding:16px; min-height:124px;">
                      <div style="display:inline-block; background:#ffc200; color:#0b0d10; font-size:16px; font-weight:900; padding:5px 10px; border-radius:10px;">1</div>
                      <div style="font-size:16px; line-height:1.3; font-weight:900; color:#1c222b; margin-top:10px;">Mở bot và tìm sản phẩm</div>
                      <div style="font-size:13px; line-height:1.5; color:#667085; margin-top:6px;">Vào @taikhoantenhat_bot, chọn tài khoản cần mua.</div>
                    </div>
                  </td>
                  <td class="stack" width="33.33%" valign="top" style="padding:0 3px 14px 3px;">
                    <div style="background:#fff9df; border:1px solid #ffe58a; border-radius:14px; padding:16px; min-height:124px;">
                      <div style="display:inline-block; background:#ffc200; color:#0b0d10; font-size:16px; font-weight:900; padding:5px 10px; border-radius:10px;">2</div>
                      <div style="font-size:16px; line-height:1.3; font-weight:900; color:#1c222b; margin-top:10px;">Thanh toán</div>
                      <div style="font-size:13px; line-height:1.5; color:#667085; margin-top:6px;">Quét QR hoặc chuyển khoản theo thông tin đơn hàng.</div>
                    </div>
                  </td>
                  <td class="stack" width="33.33%" valign="top" style="padding:0 0 14px 6px;">
                    <div style="background:#fff9df; border:1px solid #ffe58a; border-radius:14px; padding:16px; min-height:124px;">
                      <div style="display:inline-block; background:#ffc200; color:#0b0d10; font-size:16px; font-weight:900; padding:5px 10px; border-radius:10px;">3</div>
                      <div style="font-size:16px; line-height:1.3; font-weight:900; color:#1c222b; margin-top:10px;">Nhận thông tin</div>
                      <div style="font-size:13px; line-height:1.5; color:#667085; margin-top:6px;">Tài khoản cấp sẵn nhận nhanh, đơn nâng cấp xử lý theo mô tả sản phẩm.</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:18px 32px 30px 32px; background:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffc200; border-radius:16px;">
                <tr>
                  <td align="center" style="padding:24px 20px;">
                    <div style="font-size:24px; line-height:1.3; font-weight:900; color:#0b0d10;">
                      Nhận ưu đãi 10% ngay hôm nay
                    </div>
                    <div style="font-size:15px; line-height:1.55; color:#293241; margin-top:7px;">
                      Áp dụng cho khách cũ, giảm tối đa 100.000đ khi mua qua hệ thống mới.
                    </div>
                    <a class="btn" href="https://t.me/taikhoantenhat_bot" target="_blank" style="display:inline-block; margin-top:18px; background:#0b0d10; color:#ffffff; text-decoration:none; font-size:17px; line-height:1.2; font-weight:900; padding:15px 26px; border-radius:12px;">
                      MUA HÀNG TẠI @taikhoantenhat_bot
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:24px 32px; background:#0b0d10; color:#c8ced8; font-size:12px; line-height:1.65; text-align:center;">
              Bạn nhận được email này vì đã từng mua hàng hoặc đăng ký nhận thông tin từ Tài Khoản Tẻ Nhạt.<br>
              <a href="{{ mirror }}" style="color:#ffc200; text-decoration:underline;">Xem email trên trình duyệt</a>
              &nbsp;•&nbsp;
              <a href="{{ unsubscribe }}" style="color:#ffc200; text-decoration:underline;">Hủy nhận email</a>
              <br><br>
              © Tài Khoản Tẻ Nhạt
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

- [ ] **Step 2: Verify required campaign strings exist**

```bash
rg -n "Hệ thống|mua hàng mới|GIẢM 10%|100\\.000đ|https://t\\.me/taikhoantenhat_bot|\\{\\{ mirror \\}\\}|\\{\\{ unsubscribe \\}\\}|tenhatshop\\.taikhoantenhat\\.me/uploads/email/taikhoantenhat-system-new\\.png" taikhoantenhat_brevo_email_template.html
```

Expected: each required string appears at least once.

---

### Task 3: Verify Rendering and Scope

**Files:**
- Read: `taikhoantenhat_brevo_email_template.html`
- Read: `data/uploads/email/taikhoantenhat-system-new.png`

- [ ] **Step 1: Check that the HTML has no JavaScript**

```bash
rg -n "<script|javascript:" taikhoantenhat_brevo_email_template.html
```

Expected: no matches and exit code `1`.

- [ ] **Step 2: Check the template still uses Brevo footer variables**

```bash
rg -n "\\{\\{ mirror \\}\\}|\\{\\{ unsubscribe \\}\\}" taikhoantenhat_brevo_email_template.html
```

Expected:

The command prints two matching lines: one line containing `{{ mirror }}` and one line containing `{{ unsubscribe }}`.

- [ ] **Step 3: Open the HTML locally for visual review**

```bash
xdg-open taikhoantenhat_brevo_email_template.html >/dev/null 2>&1 || true
```

Expected: the file opens in a browser when a desktop browser is available. Confirm visually that the desktop layout is readable, the hero has text plus image, and the CTA is prominent.

- [ ] **Step 4: Confirm no forbidden runtime data is staged**

```bash
git status --short taikhoantenhat_brevo_email_template.html data/uploads/email/taikhoantenhat-system-new.png data/shop.db
```

Expected: `taikhoantenhat_brevo_email_template.html` may be modified. `data/uploads/email/taikhoantenhat-system-new.png` may be untracked. `data/shop.db` must not be staged.

- [ ] **Step 5: Commit only the template if requested**

Do not commit the upload asset by default because project instructions say not to commit `data/uploads/`. If a commit is requested, run:

```bash
git add taikhoantenhat_brevo_email_template.html
git commit -m "feat: update brevo email template"
```

Expected: commit includes only `taikhoantenhat_brevo_email_template.html`.
