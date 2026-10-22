'use strict';

const fs = require('node:fs');
const { plainText } = require('./sales-copy');

const RULES_VERSION = '1.0';
const RULES_CHECKED_AT = '2026-10-22';

const PLATFORM_RULES = Object.freeze({
  '公众号': {
    platform_id: 'wechat_article',
    label: '公众号',
    title: { unit: '字', recommended: 30, max: 64 },
    body: { unit: '字', recommended_min: 300, max: 20000 },
    tags: { unit: '个', recommended: 3, max: 5 },
    images: { unit: '张', max: 20, max_file_mb: 10, recommended_width: 1080, recommended_height: 1440, cover_ratio: '2.35:1' },
    structure: ['标题', '导语', '任务与场景', '官网原文摘录', '待确认边界', '下一步沟通'],
    tips: ['正文用小标题和短段落分段，手机阅读更顺畅。', '封面建议单独裁为 2.35:1；正文图保留原始比例。'],
  },
  '小红书': {
    platform_id: 'xiaohongshu_note',
    label: '小红书',
    title: { unit: '字', recommended: 18, max: 20 },
    body: { unit: '字', recommended_min: 220, max: 1000 },
    tags: { unit: '个', recommended: 4, max: 10 },
    images: { unit: '张', max: 18, max_file_mb: 20, recommended_width: 1080, recommended_height: 1440, cover_ratio: '3:4' },
    structure: ['短标题', '任务开场', '编号清单', '参数摘录', '待确认边界', '互动引导', '标签'],
    tips: ['首图优先 3:4 竖版；文字不要压到画面边缘。', '正文用空行和编号拆段，发布前把标签放在最后一段。'],
  },
  '朋友圈': {
    platform_id: 'moments_short_post',
    label: '朋友圈',
    title: { unit: '字', recommended: 0, max: 64, not_applicable: true },
    body: { unit: '字', recommended_min: 80, max: 2000 },
    tags: { unit: '个', recommended: 2, max: 3 },
    images: { unit: '张', max: 9, max_file_mb: 20, recommended_width: 1080, recommended_height: 1080, cover_ratio: '1:1' },
    structure: ['一行任务', '一条原文核对', '待确认边界', '轻松的行动引导'],
    tips: ['朋友圈没有独立标题，短标题只用于内部识别。', '首图建议 1:1；多图时保持同一套画面风格。'],
  },
});

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function characterCount(value) {
  return Array.from(String(value || '')).length;
}

function markdownToPlainText(value) {
  return plainText(String(value || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n'))
    .trim();
}

function gcd(first, second) {
  let a = Math.abs(Number(first) || 0);
  let b = Math.abs(Number(second) || 0);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function ratioLabel(width, height) {
  if (!width || !height) return null;
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function imageDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) break;
      if (JPEG_SOF.has(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  return null;
}

function inspectImageFile(filePath) {
  if (!filePath) return { width: null, height: null, aspect_ratio: null, file_size_bytes: null };
  const stats = fs.statSync(filePath);
  const dimensions = imageDimensions(fs.readFileSync(filePath));
  return {
    width: dimensions?.width || null,
    height: dimensions?.height || null,
    aspect_ratio: dimensions ? ratioLabel(dimensions.width, dimensions.height) : null,
    file_size_bytes: stats.size,
  };
}

function statusForLength(value, rule, kind = 'length') {
  const count = characterCount(value);
  if (kind === 'not_applicable') {
    return { status: 'info', count, value: `${count} 字`, summary: '该平台无需单独填写标题，标题块可用于内部识别。' };
  }
  if (count > rule.max) {
    return { status: 'fail', count, value: `${count}/${rule.max} ${rule.unit}`, summary: `超出平台上限 ${count - rule.max} ${rule.unit}，建议先缩短。` };
  }
  if (rule.recommended && count > rule.recommended) {
    return { status: 'warning', count, value: `${count}/${rule.max} ${rule.unit}`, summary: `未超上限，但超过 ${rule.recommended} ${rule.unit} 的舒适阅读建议。` };
  }
  if (rule.recommended_min && count < rule.recommended_min) {
    return { status: 'warning', count, value: `${count} ${rule.unit}`, summary: `内容偏短，建议至少 ${rule.recommended_min} ${rule.unit}，补足任务和边界。` };
  }
  return { status: 'pass', count, value: `${count}${rule.max ? `/${rule.max}` : ''} ${rule.unit}`, summary: '长度在发布建议范围内。' };
}

function tagsText(tags) {
  return (tags || []).map(tag => `#${plainText(tag).replace(/^#+/, '')}`).join(' ');
}

function statusForTagCount(tags, rule) {
  const count = Array.isArray(tags) ? tags.length : 0;
  if (count > rule.max) {
    return { status: 'fail', count, value: `${count}/${rule.max} ${rule.unit}`, summary: `标签过多，建议删到 ${rule.max} ${rule.unit}以内。` };
  }
  if (count === 0) {
    return { status: 'warning', count, value: `0 ${rule.unit}`, summary: `尚未添加标签，建议补充 ${rule.recommended} ${rule.unit}左右。` };
  }
  return { status: 'pass', count, value: `${count}/${rule.max} ${rule.unit}`, summary: '标签数量在发布建议范围内。' };
}

function copyBlock(id, label, text, check, note) {
  return {
    id,
    label,
    text: String(text || '').trim(),
    character_count: characterCount(text),
    status: check.status,
    counter: check.value,
    note,
  };
}

function truncate(value, max) {
  const chars = Array.from(plainText(value));
  return chars.length > max ? chars.slice(0, Math.max(1, max - 1)).join('') + '…' : chars.join('');
}

function buildCoverCopy({ platform, strategy, product, title, images }) {
  const taskLabel = strategy?.task?.label || '办公选型核对';
  const audience = strategy?.audience?.label || '办公用户';
  const eyebrow = platform === '小红书' ? '先把任务列出来' : platform === '朋友圈' ? '选办公本，先看真实任务' : '选办公本，先核对再决定';
  const taskHeadlines = {
    mobility: '移动办公，先看每天怎么带着走',
    teaching: '备课展示，先理顺文件流程',
    comparison: '比电脑，先放同一张任务清单',
    batch: '批量采购，先列清确认项',
    compatibility: '软件能不能用，先核版本',
    general: '选办公本，先看任务再看参数',
  };
  const headline = platform === '小红书'
    ? (taskHeadlines[strategy?.task?.id] || truncate(title, 18))
    : truncate(title, 22);
  const support = `${product?.product_name || product?.resolved_name || '候选型号'}｜${taskLabel}`;
  const badge = platform === '朋友圈' ? '不着急下结论' : '资料先核对 · 条件再确认';
  const footer = '公开资料整理｜配置、兼容与报价以实际确认结果为准';
  const coverImage = (images || []).find(item => item.position === 'cover') || (images || [])[0] || null;
  return {
    eyebrow,
    headline,
    support,
    badge,
    footer,
    audience_hint: audience,
    copy_text: [eyebrow, headline, support, badge, footer].filter(Boolean).join('\n'),
    image_id: coverImage?.image_id || null,
    image_caption: coverImage?.caption || '无精确型号封面图时使用纯文字封面。',
    suggested_layout: platform === '小红书'
      ? '3:4 竖版；上方 1/3 放大标题，下方留白放型号与边界。'
      : platform === '朋友圈'
        ? '1:1 方图；标题居中，右下角放“条件再确认”。'
        : '2.35:1 横版；左侧标题，右侧保留产品主体与留白。',
    safety_note: '封面只使用已核对产品名称和任务词；不使用“最强”“必买”“保证兼容”等表述。',
  };
}

function checkImages(images, rule) {
  const items = (images || []).map(image => {
    const width = image.width || null;
    const height = image.height || null;
    const sizeMb = image.file_size_bytes ? image.file_size_bytes / (1024 * 1024) : null;
    const issues = [];
    if (!width || !height) issues.push('未读取到像素尺寸');
    else if (width < rule.recommended_width || height < rule.recommended_height) issues.push(`低于 ${rule.recommended_width}×${rule.recommended_height} 建议尺寸`);
    if (sizeMb && sizeMb > rule.max_file_mb) issues.push(`文件超过 ${rule.max_file_mb} MB`);
    return {
      image_id: image.image_id,
      file_name: image.file_name,
      width,
      height,
      aspect_ratio: image.aspect_ratio,
      file_size_bytes: image.file_size_bytes,
      dimension_label: width && height ? `${width}×${height}` : '尺寸待读取',
      status: issues.length ? 'warning' : 'pass',
      summary: issues.length ? issues.join('；') : '像素与文件大小达到本地建议值。',
    };
  });
  const failures = images.length > rule.max;
  return {
    status: failures ? 'fail' : items.some(item => item.status === 'warning') ? 'warning' : 'pass',
    count: images.length,
    limit: rule.max,
    recommended: `${rule.recommended_width}×${rule.recommended_height}`,
    cover_ratio: rule.cover_ratio,
    items,
    summary: failures
      ? `共 ${images.length} 张，超过平台建议上限 ${rule.max} 张。`
      : items.length
        ? `共 ${images.length} 张；像素和比例已逐张读取，封面建议 ${rule.cover_ratio}。`
        : `本次未使用图片，可先发布纯文字版本；封面建议 ${rule.cover_ratio}。`,
  };
}

function buildPublicationReadiness({ platform, title, body, tags, images, strategy, product }) {
  const rule = PLATFORM_RULES[platform];
  if (!rule) throw new Error('unsupported publication platform');
  const normalizedBody = markdownToPlainText(body);
  const normalizedTags = tagsText(tags);
  const titleCheck = statusForLength(title, rule.title, rule.title.not_applicable ? 'not_applicable' : 'length');
  const bodyCheck = statusForLength(normalizedBody, rule.body);
  const tagsCheck = statusForTagCount(tags, rule.tags);
  const imageCheck = checkImages(images, rule.images);
  const copyBlocks = [
    copyBlock('title', '标题', title, titleCheck, rule.title.not_applicable ? '朋友圈没有独立标题，建议只在内部留档。' : '直接复制到平台标题栏。'),
    copyBlock('body', '正文', normalizedBody, bodyCheck, '已去除 Markdown、图片标记和内部字段，可直接粘贴。'),
    copyBlock('tags', '标签', normalizedTags, tagsCheck, normalizedTags ? '直接复制到正文末尾或标签栏。' : '当前平台无需单独标签。'),
  ];
  const items = [
    { id: 'title_length', label: '标题长度', ...titleCheck, limit: rule.title.max, recommendation: rule.title.recommended ? `建议不超过 ${rule.title.recommended} 字` : '无需单独标题' },
    { id: 'body_length', label: '正文字数', ...bodyCheck, limit: rule.body.max, recommendation: rule.body.recommended_min ? `建议至少 ${rule.body.recommended_min} 字` : '' },
    { id: 'tag_count', label: '标签数量', ...tagsCheck, limit: rule.tags.max, recommendation: `建议 ${rule.tags.recommended} 个以内` },
    { id: 'image_checks', label: '图片尺寸与数量', ...imageCheck, recommendation: `建议封面 ${rule.images.cover_ratio}、${rule.images.recommended_width}×${rule.images.recommended_height} 以上` },
    {
      id: 'layout_structure', label: '排版结构', status: 'pass', count: rule.structure.length,
      value: rule.structure.join(' → '), summary: '当前正文已按平台阅读结构分段。', recommendation: rule.tips.join(' '),
    },
  ];
  const warningCount = items.filter(item => item.status === 'warning').length;
  const failCount = items.filter(item => item.status === 'fail').length;
  const passCount = items.filter(item => item.status === 'pass').length;
  const coverCopy = buildCoverCopy({ platform, strategy, product, title, images });
  const readyCount = (images || []).filter(image => image.publication_ready).length;
  const imagePack = {
    status: !images?.length ? 'empty' : readyCount === images.length ? 'authorized_ready' : 'review_only_rights_pending',
    authorized_count: readyCount,
    total_count: images?.length || 0,
    note: !images?.length
      ? '本次没有使用图片；可使用纯文字稿和纯文字封面。'
      : readyCount === images.length
        ? '图片已通过当前授权与发布状态检查，可进入下载包。'
        : `当前 ${images.length} 张均为精确型号审稿图，其中 ${images.length - readyCount} 张仍需发布授权；图片包仅供内部审稿。`,
    cover_image: coverCopy.image_id,
    items: (images || []).map((image, index) => ({
      order: index + 1,
      image_id: image.image_id,
      file_name: image.file_name,
      download_url: image.asset_url,
      width: image.width || null,
      height: image.height || null,
      aspect_ratio: image.aspect_ratio || null,
      file_size_bytes: image.file_size_bytes || null,
      dimension_label: image.width && image.height ? `${image.width}×${image.height}` : '尺寸待读取',
      rights_status: image.rights_status,
      publication_ready: image.publication_ready === true,
    })),
  };
  return {
    version: RULES_VERSION,
    rules_checked_at: RULES_CHECKED_AT,
    platform_id: rule.platform_id,
    copy_blocks: copyBlocks,
    cover_copy: coverCopy,
    image_pack: imagePack,
    checks: {
      overall_status: failCount ? 'fail' : warningCount ? 'warning' : 'pass',
      summary: { pass_count: passCount, warning_count: warningCount, fail_count: failCount },
      items,
      layout: { structure: rule.structure, tips: rule.tips, status: 'pass' },
      note: '以上为本地发布前建议，平台规则可能调整；发布时仍以对应编辑器提示为准。',
    },
  };
}

module.exports = {
  PLATFORM_RULES,
  RULES_VERSION,
  characterCount,
  markdownToPlainText,
  imageDimensions,
  inspectImageFile,
  ratioLabel,
  tagsText,
  buildPublicationReadiness,
};