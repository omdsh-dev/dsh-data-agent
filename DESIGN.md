# Design

## Theme

工作台完全跟随宿主 dsh web GUI 的主题:所有颜色、边框、文字、状态都通过宿主 `--dsw-alias-*` / `--dsw-static-*` 设计令牌解析,浅色(`body`)与深色(`body[data-ds-dark-theme]`)两套主题自动适配。工作台不定义自己的主题,也不使用 `--dsh-color-*` 变量(宿主未定义该命名空间)。

每个 `var()` 都带一个中性兜底值,保证令牌缺失时界面仍可读。

## Color

- **强调色(唯一 accent)**:`--dsw-alias-button-info-fill`(DeepSeek 蓝),用于主操作按钮、选中态图标、聚焦描边。使用占比 ≤10%。
- **主文字**:`--dsw-alias-label-primary`;次要 `--dsw-alias-label-secondary`;三级 `--dsw-alias-label-tertiary`;说明 `--dsw-alias-label-caption`。
- **表面**:卡片透明,仅 1px 边框 `--dsw-alias-border-l2`;输入控件用 `--dsw-alias-bg-layer-2`;SQL 结果用 `--dsw-alias-markdown-code-block`。
- **侧栏(active 左栏)**:`--dsw-specific-sidebar-fill`,与宿主侧栏同源。
- **状态**:成功 `--dsw-alias-state-success-primary`;错误文字 `--dsw-alias-state-error-primary`、错误边框 `--dsw-alias-state-error-secondary`、错误底色 `--dsw-alias-interactive-bg-hover-danger`。
- **悬停**:`--dsw-alias-interactive-bg-hover`;选中 `--dsw-alias-interactive-bg-active`。
- 不使用 `#000` / `#fff` 之外的纯色;按钮上的白色文字属于宿主令牌体系(primary 按钮配白字)。

## Typography

- 正文:宿主 `--dsw-font-family`(系统字体栈,含 PingFang SC / Microsoft YaHei)。
- 等宽:宿主 `--ds-font-family-code`,用于库名、表名、SQL 输入与执行结果、列结构表。
- 字号层级(px):11 label / 11.5 hint / 12 正文与树 / 12.5 SQL 输入 / 13 表单与按钮。标题用 11px 大写 + 0.06em 字距 + 600 字重,与正文形成对比而非靠字号放大。
- 行高:表单与树 1.5;SQL 输入 1.6;结果 1.55。

## Spacing

- 卡片间距 12px;卡片内间距 12×14;字段间距 10px;栅格双列字段间距 10px。
- 行高:输入框 32px、按钮 32px、树行 28px、浏览行 36px、摘要行 28px。
- 小号按钮(摘要行内)24px 高、6px 圆角。

## Radius

- 卡片 12px;输入框 8px;SQL 输入 10px;树行 7px;标签胶囊 999px;结果块 8px。
- 与宿主半径语言一致(宿主:输入 8/22、对话框 24、行 6–8)。

## Elevation

- 工作台区块用 1px 边框(`--dsw-alias-border-l2`)分层,不依赖投影;卡片不嵌套。
- Modal 复用宿主 `Modal` 原语(自带 `--dsw-shadow-lv3` 与遮罩),仅通过 className 控制宽高:宽 `min(900px, 94vw)`,主体高 `min(540px, 58vh)`,两列内部各自滚动。

## Components

### 连接表单
- 数据库类型下拉(宿主样式化 select,自绘 chevron);主机/端口、用户名/密码各成双列栅格;库名整行。
- 未连接时主按钮「连接」(强调色,整行宽);已连接展开态显示「收起 / 断开」幽灵按钮。
- 字段聚焦:边框转强调色 + 3px `color-mix` 光晕。

### 连接摘要行
- `StateDot done`(宿主原语)+ 绿色「已连接」+ 类型胶囊(等宽 11px)+ 库名(等宽,省略号)+ 两个小号幽灵按钮。

### 库表浏览入口
- 导航行样式:表格图标(强调色)+ 文案 + 右端 chevron,整行可点。

### SQL 命令框
- 等宽 textarea,min-height 190px,可纵向拉伸;`Ctrl/⌘ + Enter` 运行;运行按钮带 play 图标;右侧快捷键提示。
- 结果 `<pre>`:等宽、`--dsw-alias-markdown-code-block` 底色、max-height 200px 内滚动。

### 库表 Modal(文件浏览器式树)
- 左列:库=文件夹行(chevron 旋转 90° + 文件夹图标 + 等宽库名 + 表数徽标),子表行缩进 22px 并以 1px 中性引导线连接;整树独立滚动。
- 右列:表结构表格,表头 sticky,悬停行高亮;未选中表时显示虚线空态。
- 底部操作提示行(说明文字)。

### 错误条
- 三角警示图标 + 标题行(错误色)+ 错误详情,浅红底、红边框。

## Iconography

- 内联 16×16 描边 SVG(stroke 1.2),`currentColor` 着色:数据库柱(连接)、终端( SQL)、文件夹(库)、表格网格(表/浏览)、chevron(展开/导航)、三角警示(错误)、play(运行)。
- primitives 包不导出图标原子,故全部内联;不引入图标库依赖。

## Motion

- 仅两处状态型过渡:chevron 旋转 150ms ease-out(transform);输入/按钮颜色过渡 150ms ease-out。
- 不动画布局属性,无装饰性动效,遵守宿主 reduced-motion 处理。

## Accessibility

- 所有可点元素为原生 button/input/select,可键盘聚焦,`:focus-visible` 有明确光晕。
- Escape 关闭 Modal(宿主原语自带)。
- 状态不以颜色单独表达:连接有文字标签,错误有图标+文字。
- 图标均 `aria-hidden`,语义靠邻近文本。
