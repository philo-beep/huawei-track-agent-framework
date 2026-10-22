# 销售工作助手 UI 改版交接

日期：2026-10-22。负责人范围：C 前端；改动仅位于 `frontend/` 与 `assets/`。

## 改版重点与布局

- 从横向步骤条改为桌面左侧流程导航、右侧当前任务；客户画像、产品匹配、内容准备、报价与成交仍保持原有四步业务。
- 当前步骤和主操作使用华为红，白底、暖灰与深蓝灰承载内容；品牌花瓣与少量红色点缀建立识别。
- 客户画像改为暖白引导卡与独立输入区；保留覆盖进度、待确认项、资料依据和结果导出。
- 窄屏将导航移到顶部两行，内容改为单列；登录、注册、管理员和退出入口继续沿用原事件及权限。

## 吉祥物“小麦”

小麦是原创卡通小狗，蜂蜜棕毛色、奶油色肚皮、短腿大头、卷尾巴和红色围巾。欢迎页、登录页采用面朝右侧的全身造型：近侧眼睛带高光，远侧眼睛眯起，笑脸配抬爪招呼，形成友善的销售陪伴助手形象。

| 位置 | 呈现方式 | 作用 |
| --- | --- | --- |
| 欢迎页 | 约 300–380px 宽的全身主形象，四步流程缩为下方卡片 | 首屏明确“销售陪伴助手”定位 |
| 登录页 | 大幅全身小麦与独立对话气泡，右侧为登录表单 | “销售每一步，都有小麦陪着你” |
| 流程侧栏 | 紧凑头像与随步骤变化的提示 | 指明当前可做的下一步 |
| 客户画像 | 头像、暖白引导、覆盖进度与信息维度 | 降低录入压力，允许未知信息待确认 |

全身原稿：`assets/xiaomai-full.svg`；透明预览：`assets/xiaomai-full.png`（720 × 760）。页面以同页 SVG 符号复用，不增加静态路由或网络依赖。尾巴、抬爪、点头和浮动由 CSS 控制；原“暂停动效”及系统减少动态效果设置均覆盖新增动画。

## 验证

- HTML 标签平衡、ID 唯一、SVG XML 解析通过。
- 与改版前比较，原有 DOM ID、表单约束、按钮行为属性及 JS ID 引用保留；`app.js`、`auth.js` 语法检查通过。
- 产品匹配、内容生成、三平台内容、发布检查、销售文案和方案回归共 51 项通过。
- 逐步画像、内容 HTTP 接口与访问控制回归共 13 项通过，覆盖登录、CSRF、权限、内容导出与图片服务。
- 吉祥物已实际栅格化为 PNG 并检查形象。浏览器访问本地页面的授权曾被拒绝，未绕过；整页桌面/手机截图和浏览器目测仍待完成，不把代码层响应式实现当作浏览器验收完成。

主要复现命令（在 `huawei-sales-agent/` 下）：

```powershell
python backend/main.py
node --check frontend/static/js/app.js
node --check frontend/static/js/auth.js
node --test tests/guided_profile.test.js tests/content_api.test.js tests/access_control.test.js
node --test tests/product_match.test.js tests/content_generation.test.js tests/publication_readiness.test.js tests/sales_copy.test.js tests/extension_regression.test.js tests/solution_planning.test.js tests/release_verification.test.js tests/creative_copy.test.js
```

人工复核路径：欢迎页 → 进入工作台 → 登录/注册 → 四步切换 → 画像重新开始 → 产品匹配示例 → 内容复制/导出 → 报价与成交。检查 1440px、1024px、768px、390px 和 320px 宽度，以及暂停动效和减少动态效果。

## Git 与交付边界

- 分支：`codex/ui-sales-companion`。
- 改版前检查点：`checkpoint/ui-before-redesign-20261022`。
- 工作台初版提交：`ac57753`，可用于比较全身吉祥物调整前后的差异。
- 改动不涉及后端、Agent、数据区或其他模块工作区；未发布公网版本。
