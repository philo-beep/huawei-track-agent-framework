'use strict';

const crypto = require('node:crypto');
const { plainText, cleanSourceTitle } = require('./sales-copy');

const AUDIENCE_STYLES = Object.freeze([
  {
    id: 'educator',
    label: '教师与教研人员',
    noun: '教研老师',
    reader_moment: '读者通常正在备课、整理课堂材料，或准备把文件带到教室和大屏上',
    lead_tail: '对每天备课、改稿、进课堂的人来说，先把文件流程走一遍更实际。',
    tone: '具体、实用、少用技术词',
    pattern: /老师|教师|教研|培训|备课|课堂|教务/,
  },
  {
    id: 'executive',
    label: '业务负责人与管理者',
    noun: '业务负责人',
    reader_moment: '读者更关心能不能少走弯路，而不是先看一长串参数',
    lead_tail: '对要做决定的人来说，先弄清楚影响和边界，比堆一页参数更有用。',
    tone: '直接、判断清楚、先讲影响',
    pattern: /创始人|总经理|老板|董事长|CEO|管理者|业务负责人/,
  },
  {
    id: 'procurement',
    label: '采购与行政决策者',
    noun: '采购负责人',
    reader_moment: '读者需要把需求、风险和确认项整理成一张能复盘的清单',
    lead_tail: '对要负责采购的人来说，最需要的是把条件、风险和待确认项放在同一张清单上。',
    tone: '审慎、清晰、把适用条件放在前面',
    pattern: /采购|行政|信息化|经办人|设备管理|IT负责人/,
  },
  {
    id: 'operations',
    label: '门店与运营人员',
    noun: '运营负责人',
    reader_moment: '读者关心这套设备能不能接上现有流程，以及每天会不会添麻烦',
    lead_tail: '在门店和流程里用电脑，先看会不会添麻烦，比看一堆跑分更直接。',
    tone: '结果导向、口语化、少铺垫',
    pattern: /门店|零售|运营|店员|店长|客服/,
  },
  {
    id: 'individual',
    label: '个人与家庭用户',
    noun: '个人用户',
    reader_moment: '读者通常想快点做决定，但不想被夸张宣传带着走',
    lead_tail: '想快点定下来，也先把每天要用的软件和文件说清楚，后面会省很多返工。',
    tone: '轻松、直接、像朋友提醒',
    pattern: /个人|家庭|学生|家长|自由职业/,
  },
  {
    id: 'general',
    label: '通用办公人群',
    noun: '读者',
    reader_moment: '读者正在把模糊的办公需求收拢成可以核对的条件',
    lead_tail: '先把每天要做的事写下来，才能判断哪些参数值得看。',
    tone: '自然、克制、先场景后参数',
    pattern: /./,
  },
]);

const TASK_STYLES = Object.freeze([
  {
    id: 'compatibility',
    label: '软件与文件条件核对',
    detail: '真正要确认的是软件名称、版本、文件格式和外设，而不是只看一句笼统的兼容说明',
    title: '软件能不能用，别被一句“兼容”带过去',
    pattern: /兼容|软件|插件|系统|文件格式|外设|安装包/,
  },
  {
    id: 'teaching',
    label: '备课与课堂展示',
    detail: '重点不只是屏幕大小，还要看课件、视频和展示文件能不能顺畅接上课堂流程',
    title: '备课和课堂展示选本，先把文件流程理顺',
    pattern: /备课|课堂|教研|培训|展示|讲课|投影/,
  },
  {
    id: 'comparison',
    label: '比较与选型',
    detail: '比较时先把同一套任务放进表格，才知道哪些参数真的影响使用',
    title: '比电脑别只比参数，先放进同一张任务清单',
    pattern: /比较|对比|比价|选型|挑选|差异/,
  },
  {
    id: 'mobility',
    label: '移动办公与轮换使用',
    detail: '设备会跟着人换位置，重量只是起点，接口、续航条件和文件流转更值得先问',
    title: '移动办公选本，先看每天怎么带着走',
    pattern: /移动|轮用|差旅|通勤|外出|便携|携带/,
  },
  {
    id: 'batch',
    label: '批量采购与续购准备',
    detail: '数量、配置、交付条件和后续管理会一起影响选择，不能只看单台参数',
    title: '采购办公电脑，先把数量之外的确认项列出来',
    pattern: /采购|批量|续购|加购|数量|团队配置/,
  },
  {
    id: 'general',
    label: '一般办公选型',
    detail: '先把每天要做的事说清楚，再用公开资料逐项核对',
    title: '选办公电脑，先看任务再看参数',
    pattern: /./,
  },
]);

const PLATFORM_STYLES = Object.freeze({
  '公众号': {
    id: 'wechat_article',
    label: '公众号',
    tone: '顾问式长文，克制、具体、允许把边界讲透',
    structure: '场景开场 → 任务拆解 → 原文摘录 → 待确认事项 → 对话式行动引导',
    format_rule: '短段落和小标题；参数只摘与任务相关的一条，不整段倾倒原文',
  },
  '小红书': {
    id: 'xiaohongshu_note',
    label: '小红书',
    tone: '轻口语、像同事发来的核对清单，不用命令式销售口吻',
    structure: '场景钩子 → 先列任务 → 可收藏的资料卡 → 避坑提醒 → 评论区互动',
    format_rule: '短句、短段落、少量符号；标题和首屏先说读者遇到的问题',
  },
  '朋友圈': {
    id: 'moments_short_post',
    label: '朋友圈',
    tone: '第一人称、熟人对话、不端着',
    structure: '近况开场 → 一条资料 → 一条边界 → 私聊式行动引导',
    format_rule: '一到三段；不堆参数，不使用长标题或大段清单',
  },
});

const TITLE_VARIANTS = Object.freeze({
  mobility: [
    ctx => ctx.shortScenario + '，这台笔记本先核对什么？',
    ctx => ctx.shortScenario + '，别只看轻不轻',
    ctx => ctx.audience.label + '选移动办公本，先把任务摊开',
  ],
  teaching: [
    ctx => ctx.shortScenario + '，选本先看哪几件事？',
    ctx => '备课和课堂展示的文件流程，比屏幕参数更该先问',
    ctx => ctx.audience.label + '选办公本，别让文件流转卡住',
  ],
  compatibility: [
    ctx => ctx.shortScenario + '，先别把“能用”说太早',
    ctx => '软件和文件条件没对上，参数再漂亮也白搭',
    ctx => ctx.audience.label + '核对办公电脑，先问清软件条件',
  ],
  comparison: [
    ctx => ctx.shortScenario + '，先别只比处理器',
    ctx => '两台电脑怎么比？先把同一套任务摆出来',
    ctx => ctx.audience.label + '做选型，参数表之外还要看什么',
  ],
  batch: [
    ctx => ctx.shortScenario + '，采购前先核对这几项',
    ctx => '团队换电脑，数量之外还要确认什么',
    ctx => ctx.audience.label + '准备办公设备，先别急着定型号',
  ],
  general: [
    ctx => ctx.shortScenario + '，先核对什么？',
    ctx => '选办公电脑，先把任务放进参数之前',
    ctx => ctx.audience.label + '的办公设备核对清单',
  ],
});

const OPENER_VARIANTS = Object.freeze({
  mobility: [
    '一台电脑每天要在几个地点之间来回，先问清怎么带、带什么、到哪里接什么。',
    '移动办公最容易漏掉的，不是重量，而是离开固定工位以后文件和外设怎么接。',
    '轮换使用不是把电脑装进包里就结束了，真正麻烦的是每次换位置后的工作衔接。',
  ],
  teaching: [
    '备课和上课不是同一个动作，选本前要先看课件、视频和展示文件怎么流转。',
    '课堂场景里，最怕的不是参数不够漂亮，而是临到展示才发现文件或外设没准备好。',
    '教研老师选电脑，先把备课、修改和课堂展示这串动作走一遍。',
  ],
  compatibility: [
    '软件能不能装、文件能不能开、外设能不能接，是三个需要分别核对的问题。',
    '一句笼统的“兼容”解决不了真实工作，软件名称、版本和文件格式都要落到具体条件。',
    '选电脑时最该先问的不是跑分，而是你每天离不开的那套软件和文件流程。',
  ],
  comparison: [
    '两台电脑放在一起比，最怕各自拿不同场景的参数互相证明。',
    '比参数之前，先把每天相同的任务放到一张清单里，差异才有意义。',
    '型号越多越容易看花眼，先把不能妥协的条件圈出来再比。',
  ],
  batch: [
    '团队采购不是把单台选择乘以数量，配置、交付和后续管理都要一起核对。',
    '数量一多，最容易忽略的是配置是否统一、交付条件是否说得清。',
    '批量换设备前，先确认大家每天做的事情是不是同一类。',
  ],
  general: [
    '选办公电脑，不一定从参数表开始，更稳的顺序是先看每天要完成什么。',
    '同样的配置，放在不同任务里，优先级会完全不同。',
    '先把使用场景说清楚，再看哪些公开资料真的能回答问题。',
  ],
});

const BOUNDARY_LINES = Object.freeze([
  '软件兼容要按名称、版本、文件格式和外设逐项确认，看到型号资料不等于已经验证兼容。',
  '实际续航、发热和手感会受使用方式影响，公开资料不能替代真实体验。',
  '颜色、键盘、内存和存储等完整销售配置仍需确认；价格、库存和交付条件不能从公开参数里推出来。',
]);

const TAG_SETS = Object.freeze({
  mobility: ['华为笔记本', '移动办公', '办公电脑', '选型核对'],
  teaching: ['华为笔记本', '备课办公', '课堂展示', '选型清单'],
  compatibility: ['华为笔记本', '软件条件', '办公电脑', '选型核对'],
  comparison: ['华为笔记本', '办公电脑', '选购清单', '参数核对'],
  batch: ['华为笔记本', '企业采购', '办公设备', '选型核对'],
  general: ['华为笔记本', '办公电脑', '选型清单', '使用场景'],
});

const FACT_FIELD_RULES = Object.freeze({
  '尺寸与重量': ['重量'],
  '屏幕': ['分辨率'],
  '电池': ['容量'],
  '处理器': ['CPU'],
  '存储': [],
  '操作系统': [],
});

const FIELD_LABELS = new Set([
  '长度', '宽度', '厚度', '重量', '尺寸', '类型', '屏占比', '屏幕比例', '分辨率',
  '刷新率', '亮度', '色域', '色准', '对比度', '可视角度', '触摸屏', '材料', '容量', 'CPU',
]);

function text(value) {
  return plainText(String(value || '').replace(/\s+/g, ' ').trim()).replace(/\s+/g, ' ');
}

function listText(values, fallback) {
  if (!Array.isArray(values) || !values.length) return fallback || '';
  return [...new Set(values.map(text).filter(Boolean))].join('、');
}

function hashPick(seed, length) {
  if (!length) return 0;
  const digest = crypto.createHash('sha256').update(String(seed)).digest();
  return digest.readUInt32BE(0) % length;
}

function audienceFor(profile) {
  const haystack = [profile.audience, profile.industry, profile.raw_request].filter(Boolean).join(' ');
  return AUDIENCE_STYLES.find(item => item.pattern.test(haystack)) || AUDIENCE_STYLES[AUDIENCE_STYLES.length - 1];
}

function taskFor(profile) {
  const primary = [profile.scenario, ...(profile.needs || []), ...(profile.preferences || [])].filter(Boolean).join(' ');
  const byPrimary = TASK_STYLES.find(item => item.pattern.test(primary));
  if (byPrimary && byPrimary.id !== 'general') return byPrimary;
  const secondary = (profile.pain_points || []).filter(Boolean).join(' ');
  return TASK_STYLES.find(item => item.pattern.test(secondary)) || TASK_STYLES[TASK_STYLES.length - 1];
}

function shortScenario(profile) {
  const raw = text(profile.scenario) || '本次办公任务';
  return raw.split(/[，,。；;]/)[0].replace(/需要移动办公$/, '').slice(0, 32) || '本次办公任务';
}

function factHeading(fact) {
  const heading = String(fact.claim || '').split('\n').find(line => line.startsWith('## '));
  return heading ? heading.replace(/^##\s+/, '').trim() : '公开资料';
}

function factParagraphs(fact) {
  return String(fact.claim || '').split(/\n{2,}/).map(item => item.trim()).filter(Boolean)
    .filter(item => !/^##\s+/.test(item) && !/^\*/.test(item));
}

function valueAfterLabel(paragraphs, label) {
  const index = paragraphs.findIndex(item => item === label);
  if (index < 0) return '';
  const values = [];
  for (let cursor = index + 1; cursor < paragraphs.length; cursor += 1) {
    const item = paragraphs[cursor];
    if (!item || item.startsWith('*')) break;
    if (FIELD_LABELS.has(item)) break;
    values.push(item);
    break;
  }
  return values.join('；');
}

function sourceTitleFor(fact) {
  const source = Array.isArray(fact.source_refs) ? fact.source_refs[0] : null;
  return source ? cleanSourceTitle(source.title || '华为官网公开资料') : '华为官网公开资料';
}

function highlightFor(fact) {
  const heading = factHeading(fact);
  const paragraphs = factParagraphs(fact);
  const rule = Object.prototype.hasOwnProperty.call(FACT_FIELD_RULES, heading) ? FACT_FIELD_RULES[heading] : null;
  let label = heading;
  let value = '';

  if (rule && rule.length) {
    for (const field of rule) {
      const candidate = valueAfterLabel(paragraphs, field);
      if (candidate) {
        label = field;
        value = candidate;
        break;
      }
    }
  }
  if (!value) {
    const preferred = paragraphs.filter(item => !FIELD_LABELS.has(item)).slice(0, 2);
    value = preferred.join('；') || paragraphs.slice(0, 1).join('；');
  }
  if (!value) return null;
  const displayLabel = label === '容量' ? '电池容量' : label === '分辨率' ? '屏幕分辨率' : label === 'CPU' ? '处理器' : label;
  return {
    heading,
    label: displayLabel,
    value,
    quote: displayLabel === heading ? value : displayLabel + '：' + value,
    source_title: sourceTitleFor(fact),
  };
}

function buildHighlights(facts) {
  return (facts || []).map(highlightFor).filter(Boolean);
}

function titleFor(platform, strategy, context) {
  const variants = TITLE_VARIANTS[strategy.task.id];
  const picked = variants[strategy.variant.title % variants.length](context);
  if (platform === '朋友圈') return context.product.product_name + '｜' + context.shortScenario;
  if (platform === '小红书' && picked.length > 30) return context.shortScenario + '｜先列任务，再看资料';
  return picked;
}

function leadFor(platform, strategy, context) {
  const opener = OPENER_VARIANTS[strategy.task.id][strategy.variant.opener % OPENER_VARIANTS[strategy.task.id].length];
  if (platform === '公众号') {
    return text(opener + strategy.audience.lead_tail + '这次围绕“' + context.scenario + '”整理。');
  }
  if (platform === '小红书') {
    return '先别急着看参数。' + opener + '这次把“' + context.scenario + '”拆成一份能直接照着核对的清单。';
  }
  return '这次在核对“' + context.scenario + '”，看的是 ' + context.product.product_name + '。' + opener;
}

function sceneBlock(platform, strategy, context) {
  const needs = listText(context.profile.needs, '任务条件还没完全写清');
  const pain = listText(context.profile.pain_points, '还没有列出待确认项');
  if (platform === '朋友圈') {
    return {
      id: 'context',
      markdown: '先看的不是“哪台更强”，而是每天要做什么：' + needs + '。还需要重点确认：' + pain + '。',
    };
  }
  if (platform === '小红书') {
    return {
      id: 'context',
      markdown: '01｜先把任务列出来\n\n' +
        '• 要完成：' + context.scenario + '\n' +
        '• 候选型号：' + context.product.product_name + '\n' +
        '• 已知条件：' + needs + '\n' +
        '• 还要确认：' + pain + '\n\n' +
        strategy.task.detail + '。',
    };
  }
  const audience = text(context.profile.audience) || strategy.audience.label;
  return {
    id: 'context',
    markdown: '## 先把任务说清楚\n\n' +
      '这次要处理的是“' + context.scenario + '”，候选型号是 ' + context.product.product_name + '。' + strategy.task.detail + '。\n\n' +
      '已知条件：' + needs + '。仍需要重点确认：' + pain + '。\n\n' +
      '换成' + audience + '的日常动作，就是先看软件、文件、外设和携带频率，而不是先给型号下结论。',
  };
}

function factBlock(platform, highlights) {
  if (!highlights.length) {
    return {
      id: 'facts',
      markdown: platform === '公众号' ? '## 资料还不足以支撑当前判断\n\n没有找到可直接引用的官网原文，先不补写参数。' : '目前没有可直接引用的官网原文，先不补写参数。',
    };
  }
  const sources = [...new Set(highlights.map(item => item.source_title))];
  if (platform === '朋友圈') {
    const first = highlights[0];
    return {
      id: 'facts',
      markdown: '官网资料里能直接确认的是 ' + first.label + '：' + first.value + '。数值照录原文，但纸面资料还不等于你的软件和实际体验都合适。',
    };
  }
  if (platform === '小红书') {
    return {
      id: 'facts',
      markdown: '02｜官网能对上的几项\n\n' +
        highlights.map(item => '• ' + item.label + '：' + item.value).join('\n') + '\n\n' +
        '资料参考：' + sources.join('、') + '。参数按原文摘录，不做二次推断。',
    };
  }
  return {
    id: 'facts',
    markdown: '## 资料里能先确认什么\n\n' +
      '下面只摘与当前任务相关的原文项，参数值不改写，也不把公开资料当成实测体验。\n\n' +
      highlights.map(item => '- **' + item.label + '：** ' + item.value).join('\n') + '\n\n' +
      '资料出处：' + sources.join('、') + '。',
  };
}

function boundaryBlock(platform, strategy) {
  if (platform === '朋友圈') {
    return {
      id: 'boundary',
      markdown: '但兼容、实际续航、完整配置和报价都还要按具体条件确认，不能拿一条官网参数替读者做决定。',
    };
  }
  if (platform === '小红书') {
    return {
      id: 'boundary',
      markdown: '03｜这几件事别急着下结论\n\n' +
        '• ' + BOUNDARY_LINES[0] + '\n' +
        '• ' + BOUNDARY_LINES[1] + '\n' +
        '• ' + BOUNDARY_LINES[2],
    };
  }
  return {
    id: 'boundary',
    markdown: '## 哪些事还不能替你下结论\n\n' +
      BOUNDARY_LINES.map(item => '- ' + item).join('\n'),
  };
}

function ctaFor(platform, strategy, context) {
  if (platform === '小红书') {
    return '也在做同样的选择？把你的使用场景、常用软件版本和文件格式留在评论区，我先帮你列核对项。';
  }
  if (platform === '朋友圈') {
    return '也在选办公本的话，直接把常用软件和使用场景发我，我先帮你排一遍。';
  }
  return '如果你正在核对“' + context.scenario + '”，把常用软件和版本、主要文件格式、外设，以及需要携带的频率发来。我们先按条件列清单，再确认演示和报价。';
}

function tagsFor(platform, task) {
  const tags = TAG_SETS[task.id] || TAG_SETS.general;
  if (platform === '朋友圈') return tags.slice(0, 2);
  if (platform === '小红书') return tags.slice(0, 4);
  return [];
}

function buildExpressionStrategy(profile, platform) {
  const audience = audienceFor(profile);
  const task = taskFor(profile);
  const platformStyle = PLATFORM_STYLES[platform];
  const seed = [profile.audience, profile.scenario, ...(profile.needs || []), platform].join('|');
  return {
    schema_version: '1.0',
    audience: {
      id: audience.id,
      label: audience.label,
      reader_moment: audience.reader_moment,
      lead_tail: audience.lead_tail,
      tone: audience.tone,
    },
    task: {
      id: task.id,
      label: task.label,
      detail: task.detail,
    },
    platform: {
      id: platformStyle.id,
      label: platformStyle.label,
      tone: platformStyle.tone,
      structure: platformStyle.structure,
      format_rule: platformStyle.format_rule,
    },
    fact_policy: {
      mode: 'verbatim_excerpts',
      parameters_locked: true,
      price_locked: true,
      note: '只从已核对原文摘取值；不改写参数和价格，不补写未出现的事实。',
    },
    variant: {
      seed,
      title: hashPick(seed + '|title', 97),
      opener: hashPick(seed + '|opener', 89),
    },
  };
}

function composeCreativeDraft(input) {
  const profile = input.profile || {};
  const product = input.product || {};
  const platform = input.platform;
  const strategy = buildExpressionStrategy(profile, platform);
  const context = {
    profile,
    product,
    scenario: text(profile.scenario) || '本次办公任务',
    shortScenario: shortScenario(profile),
    audience: strategy.audience,
  };
  const highlights = buildHighlights(input.facts || []);
  const draft = {
    title: titleFor(platform, strategy, context),
    lead: leadFor(platform, strategy, context),
    blocks: [
      sceneBlock(platform, strategy, context),
      factBlock(platform, highlights),
      boundaryBlock(platform, strategy),
    ],
    cta: ctaFor(platform, strategy, context),
    tags: tagsFor(platform, strategy.task),
    expression_strategy: strategy,
    fact_highlights: highlights,
  };
  return draft;
}

function renderPublishMarkdown(input) {
  const platform = input.platform;
  const title = text(input.title);
  const lead = text(input.lead);
  const cta = text(input.cta);
  const blocks = (input.blocks || []).map(block => String(block.markdown || '').trim()).filter(Boolean);
  const sourceTitles = [...new Set((input.fact_highlights || []).map(item => item.source_title).filter(Boolean))];
  const sourceNote = sourceTitles.length ? '资料来源：' + sourceTitles.join('、') + '。' : '资料来源：华为官网公开产品页。';
  if (platform === '朋友圈') {
    return [lead, ...blocks, cta, input.tags.length ? input.tags.map(tag => '#' + tag).join(' ') : ''].filter(Boolean).join('\n\n').trim() + '\n';
  }
  if (platform === '小红书') {
    return [title, '', lead, '', ...blocks.flatMap(block => [block, '']), cta, '', input.tags.map(tag => '#' + tag).join(' ')].filter((line, index, rows) => !(line === '' && rows[index - 1] === '')).join('\n').trim() + '\n';
  }
  return ['# ' + title, '', lead, '', ...blocks.flatMap(block => [block, '']), '## 下一步沟通', '', cta].filter((line, index, rows) => !(line === '' && rows[index - 1] === '')).join('\n').trim() + '\n';
}

module.exports = {
  AUDIENCE_STYLES,
  TASK_STYLES,
  PLATFORM_STYLES,
  buildExpressionStrategy,
  composeCreativeDraft,
  renderPublishMarkdown,
  buildHighlights,
  highlightFor,
};
