const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SALT_ROUNDS = 10;

const hashPassword = async (password) => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

const generateReceiptNumber = () => {
  const year = new Date().getFullYear();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `FL-${year}-${code}`;
};

const generateTotpSecret = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  for (let i = 0; i < 20; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return secret;
};

const base32Decode = (input) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (let i = 0; i < input.length; i++) {
    const val = alphabet.indexOf(input[i].toUpperCase());
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2);
  }
  return bytes;
};

const generateTotp = (secret, counter) => {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
};

const generateBackupCodes = () => {
  const codes = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let c = 0; c < 10; c++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += '-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    codes.push(code);
  }
  return codes;
};

const getFileCategory = (filename, mimeType) => {
  const name = (filename || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) return 'doc';
  if (mime.includes('excel') || mime.includes('spreadsheet') || name.endsWith('.xls') || name.endsWith('.xlsx')) return 'xls';
  if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'].some(ext => name.endsWith(ext))) return 'image';
  return 'other';
};

const getMaxFileSize = (category) => {
  const limits = {
    pdf: 20 * 1024 * 1024,
    doc: 10 * 1024 * 1024,
    xls: 10 * 1024 * 1024,
    image: 10 * 1024 * 1024,
    other: 20 * 1024 * 1024
  };
  return limits[category] || limits.other;
};

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  hashToken,
  generateReceiptNumber,
  generateTotpSecret,
  base32Decode,
  generateTotp,
  generateBackupCodes,
  getFileCategory,
  getMaxFileSize
};
