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
    tone: '面向消费者，温暖自然，用动作和细节讲故事',
    structure: '设想场景 → 人物动作 → 相关功能与感受关注点 → 生活收尾',
    format_rule: '短段落和小标题；参数只摘与任务相关的一条，不整段倾倒原文',
  },
  '小红书': {
    id: 'xiaohongshu_note',
    label: '小红书',
    tone: '面向消费者，轻松有画面，像朋友聊生活',
    structure: '生活片段 → 两个相关功能 → 回到生活 → 自然互动',
    format_rule: '短句、短段落、少量符号；标题和首屏先说读者遇到的问题',
  },
  '朋友圈': {
    id: 'moments_short_post',
    label: '朋友圈',
    tone: '面向消费者，轻松对话，不编造亲测经历',
    structure: '设想片段 → 一项相关功能 → 生活收尾',
    format_rule: '一到三段；不堆参数，不使用长标题或大段清单',
  },
});

// These are imagined moments, never testimonials or claims about a real customer.
const STORY_SCENES = Object.freeze({
  teaching: {
    title: '上课铃响之前，把灵感留在课件里',
    opening: '想象一下：上课前，你还想给课件添一张图。桌边摊着教案，刚想到的例子舍不得删，手已经伸向了电脑。',
    action: '把这一页放大，再把旁边的讲义翻出来。备课时那些细小的改动，最后都会变成课堂上更好讲的一句话。',
    ending: '等你合上电脑走进教室，留在脑子里的，应该是怎么把这一课讲得有趣。',
  },
  mobility: {
    title: '换一个地方，接着把事情做好',
    opening: '想象一下：手边的文稿还差一段，你已经该换个地方了。把电脑合上、装进包，到了下一张桌子，再把刚才的思路接回来。',
    action: '座位会换，手里的事情还在继续。你要带走的除了文件，还有那句没写完的话，以及刚刚理清的思路。',
    ending: '等下一次出门，包里放的是一台陪你做事的电脑，心里装的是今天想完成的事。',
  },
  comparison: {
    title: '把电脑放回你的日常，再做选择',
    opening: '想象一下：两台电脑摆在桌上，你打开的却是自己那份改了一半的文稿。纸上密密麻麻的参数，终于有了一个具体的问题：哪台更适合陪你把它写完？',
    action: '打开熟悉的文件，改一段文字，再看看排版。你每天重复的小动作，恰好能帮你找到真正值得比较的地方。',
    ending: '试完再合上电脑，这次选择，就有了属于你自己的理由。',
  },
  compatibility: {
    title: '一份熟悉的文件，带你认识新电脑',
    opening: '想象一下：你带着一份常用文稿来看看新电脑。那些反复调过的字体、留着批注的段落，才是你最在意的东西。',
    action: '先从这份文件开始：打开它，改一句，再试着保存和导出。把熟悉的工作走一遍，你才能知道新伙伴是否合拍。',
    ending: '等熟悉的工作有了答案，再决定要不要让它加入你的日常。',
  },
  batch: {
    title: '从一张办公桌，想一想团队的日常',
    opening: '不妨设想一个普通的早晨：同事陆续坐下，有人打开文稿，有人准备开会。选电脑这件事，也从这些小动作里慢慢有了方向。',
    action: '挑一份大家常用的文件，看看日常会怎样打开、修改和分享。不同岗位的习惯，也值得各自试一试。',
    ending: '让每天用它的人先坐下来试试，这个选择才会更贴近大家的工作。',
  },
  general: {
    title: '给今天的灵感，找一张能展开的桌子',
    opening: '想象一下：你刚坐下，脑子里那句话还热乎着。杯子放到一旁，打开文稿，先把它记下来，今天的工作就这样开始了。',
    action: '写一段，停一下，再回头改一改。电脑在日常里的存在感，往往就藏在这些很小的动作中。',
    ending: '等这一页写完，合上电脑，今天又有一件想做的事落了地。',
  },
  creator: {
    title: '咖啡还温着，刚才那句灵感也在',
    opening: '想象一下：你在咖啡馆靠窗坐下，杯子还温着，手机里留着路上想到的那句话。把电脑打开，先接住它，稿子可以再往前走一小段。',
    action: '光标停在最后一行，你把一句话删掉，换成更贴近心意的表达。外面的人继续赶路，你也有自己的节奏：改稿、整理，再把作品带回家。',
    ending: '等稿子告一段落，咖啡也许凉了，好在那个想表达的意思，已经留了下来。',
  },
});

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

function hashPick(seed, length) {
  if (!length) return 0;
  const digest = crypto.createHash('sha256').update(String(seed)).digest();
  return digest.readUInt32BE(0) % length;
}

function audienceFor(profile) {
  const specific = AUDIENCE_STYLES.filter(item => item.id !== 'general');
  return specific.find(item => item.pattern.test(profile.audience || ''))
    || specific.find(item => item.pattern.test([profile.industry, profile.raw_request].filter(Boolean).join(' ')))
    || AUDIENCE_STYLES[AUDIENCE_STYLES.length - 1];
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
  return raw.split(/[，,。；;]/)[0].replace(/需要移动办公$/, '').replace(/的?选型核对|核对/g, '').slice(0, 32) || '本次办公任务';
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

function sceneFor(strategy, context) {
  const sceneText = [context.profile.scenario, ...(context.profile.needs || [])].join(' ');
  if (/咖啡|写稿|创作|改稿/.test(sceneText) && strategy.audience.id === 'individual') return STORY_SCENES.creator;
  return STORY_SCENES[strategy.task.id] || STORY_SCENES.general;
}

function titleFor(platform, strategy, context) {
  const scene = sceneFor(strategy, context);
  if (platform === '朋友圈') return scene.title;
  if (platform === '小红书') return scene.title + '｜选本日常';
  return context.shortScenario + '：' + scene.title;
}

function leadFor(platform, strategy, context) {
  return sceneFor(strategy, context).opening;
}

function sceneBlock(platform, strategy, context) {
  const scene = sceneFor(strategy, context);
  if (platform === '朋友圈') return { id: 'context', markdown: '把 ' + context.product.product_name + ' 放进这样的日常，你会先在意什么？' };
  const heading = platform === '公众号' ? '## 把它放进你的一天\n\n' : platform === '小红书' ? '01｜把它放进日常\n\n' : '';
  return { id: 'context', markdown: heading + scene.action + ' 这时，可以来认识一下 ' + context.product.product_name + '。' };
}

function featureStory(item, context) {
  const heading = item.heading;
  if (/尺寸|重量/.test(heading)) return ['出门时，先想想肩上的包', '从桌边到下一站，电脑也得跟着装进包。它的重量是 ' + item.value + '。如果你常带电脑出门，这个数字值得和自己的背包一起掂量；到店装进去、背一背，比隔着屏幕想象更直观。'];
  if (/屏幕/.test(heading)) return ['坐下来，把这一页看仔细', (context.audience.id === 'educator' ? '给课件配图时，你把画面放大，想看看那处细节能不能讲清楚。' : '改稿时，你会来回读同一行字，把光标挪回去，再斟酌一个词。') + '它的' + item.label + '是 ' + item.value + '。分辨率说的是画面像素的多少；文字大小和看起来是否舒服，还是用你熟悉的文稿亲眼看看。'];
  if (/电池/.test(heading)) return ['换个座位，事情还想接着做', '出门前，你可能会看看包里有没有电源。它标注的' + item.label + '是 ' + item.value + '。容量是认识电池的一个起点；能用多久，还要看屏幕亮度和你当天打开的软件。'];
  if (/内存/.test(heading)) return ['文稿旁边，还想放几份参考', '写东西时，常常要在文稿和参考材料之间切换。它的内存选项是 ' + item.value + '。内存可以理解为工作时暂放资料的空间，具体选哪档，要结合你常开的软件和实际销售配置。'];
  if (/存储/.test(heading)) return ['把改过的版本，好好留下来', '交稿以后，素材和旧版本也许还要留着。它的存储选项是 ' + item.value + '。这部分空间用来放文件；选多大，可以先看看自己现在积攒了多少资料。'];
  if (/操作系统/.test(heading)) return ['新电脑，也要接得上旧习惯', '打开电脑后，你每天打交道的还有系统。这里标注的是 ' + item.value + '。选之前，带上常用的软件和一份样稿，试着打开、修改、保存，再导出一次；软件兼容要按实际版本确认。'];
  if (/处理器/.test(heading)) return ['你想做的事，才是挑配置的起点', '它使用的处理器是 ' + item.value + '。处理器负责执行程序中的运算；日常体验还和软件、内存等条件有关，用自己的任务试试会更具体。'];
  return ['顺着日常，多认识它一点', item.label + '：' + item.value + '。选购时，把这一项放回自己的使用习惯里看看。'];
}

function factBlock(platform, highlights, context) {
  if (!highlights.length) return { id: 'facts', markdown: '这次还没有足够的产品资料来介绍相关功能，先带着常用文件去看看实机。' };
  const stories = highlights.map(item => featureStory(item, context));
  if (platform === '朋友圈') {
    const item = highlights[0];
    return { id: 'facts', markdown: '这里先看与你日常有关的一点：' + item.label + '，' + item.value + '。' };
  }
  return { id: 'facts', markdown: stories.map(([title, body], index) =>
    (platform === '公众号' ? '## ' + title : '0' + (index + 2) + '｜' + title) + '\n\n' + body).join('\n\n') };
}

function boundaryBlock(platform, strategy, context) {
  const scene = sceneFor(strategy, context);
  if (platform === '朋友圈') return { id: 'boundary', markdown: '带着常用文稿试一试；软件兼容和实际体验，也要和自己的习惯对上。' };
  return { id: 'boundary', markdown: scene.ending + (strategy.task.id === 'compatibility' ? '' : ' 选购前，记得试一下常用软件和文件，软件兼容要以实际版本和设备为准。') };
}

function ctaFor(platform, strategy, context) {
  if (platform === '朋友圈') return '你会带它去哪儿，写下什么？';
  if (platform === '小红书') return '你的电脑最常陪你出现在哪里？也聊聊你最在意的那个小细节。';
  return '下次看实机时，带上你常用的那份文件。试着把一天里的小任务做一遍，看看它是不是你想找的伙伴。';
}

function tagsFor(platform, task) {
  const tags = TAG_SETS[task.id] || TAG_SETS.general;
  if (platform === '朋友圈') return tags.slice(0, 2);
  if (platform === '小红书') return tags.slice(0, 4);
  return tags.slice(0, 3);
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
      factBlock(platform, highlights, context),
      boundaryBlock(platform, strategy, context),
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
    return [lead, ...blocks, cta, sourceNote, input.tags.length ? input.tags.map(tag => '#' + tag).join(' ') : ''].filter(Boolean).join('\n\n').trim() + '\n';
  }
  if (platform === '小红书') {
    return [title, '', lead, '', ...blocks.flatMap(block => [block, '']), cta, '', sourceNote, '', input.tags.map(tag => '#' + tag).join(' ')].filter((line, index, rows) => !(line === '' && rows[index - 1] === '')).join('\n').trim() + '\n';
  }
  return ['# ' + title, '', lead, '', ...blocks.flatMap(block => [block, '']), '## 把选择放回你的日常', '', cta, '', sourceNote].filter((line, index, rows) => !(line === '' && rows[index - 1] === '')).join('\n').trim() + '\n';
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
