'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readReviewedImage } = require('./content-generation');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function safeFileName(value, index, extension) {
  const raw = path.basename(String(value || `image-${index + 1}.${extension}`));
  const cleaned = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100);
  return `${String(index + 1).padStart(2, '0')}-${cleaned || `image.${extension}`}`;
}

function extensionFor(image) {
  if (image.mime_type === 'image/png') return 'png';
  if (image.mime_type === 'image/jpeg') return 'jpg';
  return 'bin';
}

function buildContentImagePack(result) {
  const images = Array.isArray(result?.image_sources) ? result.image_sources : [];
  const entries = [];
  const manifest = {
    product: result?.product?.resolved_name || null,
    platform: result?.platform || null,
    generated_at: new Date().toISOString(),
    authorized: images.length > 0 && images.every(image => image.publication_ready === true),
    note: images.every(image => image.publication_ready === true)
      ? '图片已通过当前授权与发布状态检查。'
      : '图片为精确型号审稿素材，公开发布授权和人工终审仍需确认。',
    cover_image_id: result?.publication_readiness?.cover_copy?.image_id || null,
    images: [],
  };
  images.forEach((image, index) => {
    const asset = readReviewedImage(image.sha256);
    const fileName = safeFileName(image.file_name, index, extensionFor(image));
    entries.push({ name: `images/${fileName}`, data: fs.readFileSync(asset.filePath) });
    manifest.images.push({
      order: index + 1,
      file: `images/${fileName}`,
      caption: image.caption,
      width: image.width || null,
      height: image.height || null,
      aspect_ratio: image.aspect_ratio || null,
      rights_status: image.rights_status,
      publication_ready: image.publication_ready === true,
      original_url: image.original_url,
      page_url: image.page_url || null,
    });
  });
  entries.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) + '\n' });
  entries.unshift({
    name: 'README.txt',
    data: `${manifest.authorized ? '图片包状态：授权检查通过' : '图片包状态：仅供内部审稿，公开发布授权待补'}\n\n${manifest.note}\n\n封面图片 ID：${manifest.cover_image_id || '无（使用纯文字封面）'}\n`
      + '图片尺寸、来源和授权状态见 manifest.json。\n',
  });
  return { buffer: storedZip(entries), manifest };
}

module.exports = { crc32, storedZip, buildContentImagePack };