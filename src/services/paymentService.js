const config = require('../config');

const paymentService = {
  getBanks() {
    const banks = [config.BANK];
    if (config.BANK2) banks.push(config.BANK2);
    return banks;
  },
  getBank(index) {
    if (index === 1 && config.BANK2) return config.BANK2;
    return config.BANK;
  },
  /**
   * Build payment code from order id. Format: PNS<id> (e.g. PNS100123)
   */
  buildPaymentCode(orderId) {
    return `PNS${orderId}`;
  },
  /**
   * Build wallet topup memo. PNS<username> when username present (Telegram
   * usernames are 5–32 chars and must start with a letter, so they never
   * collide with order ids which are pure digits). Falls back to PNSU<tgid>
   * to keep matcher unambiguous.
   */
  buildTopupMemo(user) {
    const username = user.username;
    if (username && username.length >= 5) return `PNS${username}`;
    return `PNSU${user.telegram_id || user.id}`;
  },
  generateQRUrl(amount, content, bank = null) {
    const b = bank || config.BANK;
    return (
      `https://img.vietqr.io/image/${b.BIN}-${b.ACCOUNT}-qr_only.png` +
      `?amount=${amount}` +
      `&addInfo=${encodeURIComponent(content)}` +
      `&accountName=${encodeURIComponent(b.ACCOUNT_NAME)}`
    );
  },
  /**
   * Bare QR (no surrounding chrome — just the QR pattern). Used for
   * compositing into the QR template.
   */
  generateBareQRUrl(amount, content, bank = null) {
    const b = bank || config.BANK;
    return (
      `https://img.vietqr.io/image/${b.BIN}-${b.ACCOUNT}-qr_only.png` +
      `?amount=${amount}` +
      `&addInfo=${encodeURIComponent(content)}`
    );
  },
  /**
   * Local QR composite — no VietQR API call. Builds the EMV string in
   * Node, renders to PNG via qrcode lib, composites onto the mascot
   * template, returns a JPEG Buffer.
   */
  async generateCompositeBuffer(amount, content, bank = null) {
    const qrCompositeService = require('./qrCompositeService');
    const b = bank || config.BANK;
    return qrCompositeService.compositeLocal({
      bin: b.BIN,
      account: b.ACCOUNT,
      amount,
      addInfo: content,
    });
  },
  /**
   * Telegram-ready QR media. Tries the local composite first;
   * if it throws (sharp error, qrcode error, anything), falls back to the
   * chrome VietQR URL so the customer still gets a payable QR.
   * Returns either { source: Buffer } or a string URL — both are accepted
   * by Telegraf's replyWithPhoto.
   */
  async getQRMedia(amount, content, bank = null) {
    try {
      const buf = await this.generateCompositeBuffer(amount, content, bank);
      return { source: buf };
    } catch (err) {
      console.error('QR composite failed, falling back to URL:', err.message);
      return this.generateQRUrl(amount, content, bank);
    }
  },
  buildPayment(orderId, amount, bankIndex = 0) {
    const bank = this.getBank(bankIndex);
    const paymentCode = this.buildPaymentCode(orderId);
    return {
      paymentCode,
      qrUrl: this.generateQRUrl(amount, paymentCode, bank),
      bankName: bank.NAME,
      accountNumber: bank.ACCOUNT,
      accountName: bank.ACCOUNT_NAME,
      amount,
    };
  },
};

module.exports = paymentService;
