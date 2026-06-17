# 从书签搜索到个人知识库：Flow Search 进化方案

> 参考 WisMe.ai 的理念："What you read, becomes you."
> 目标：让书签不再只是收藏，而是变成可检索、可关联、可回忆的个人知识体系。

---

## 一、核心理念对比

### WisMe.ai 的四步模型

| 步骤 | WisMe.ai | Flow Search 现状 | 差距 |
|------|----------|-----------------|------|
| **Observe** | 静默记录实际阅读行为（停留时间、滚动、回访） | 只记录书签，不追踪阅读 | 🔴 缺失 |
| **Distill** | 每晚 AI 提取概念、论点、数据、引用 | 索引时生成摘要+标签 | 🟡 基础已有 |
| **Weave** | 跨天、跨领域自动关联 | 基于标签的简单图谱 | 🟡 需深化 |
| **Research** | 搜索内部知识+外部网络，生成研究报告 | 基础 RAG 问答 | 🟡 需增强 |

### Flow Search 的独特优势

- ✅ 已有完整的书签索引管线（Jina Reader + LLM + Embedding）
- ✅ 已有 Orama 混合搜索引擎
- ✅ 已有知识图谱页面（tag-cloud）
- ✅ 已有 RAG 问答能力
- ✅ 已有 GitHub/Twitter 同步
- ✅ 开源、本地优先、隐私友好

---

## 二、进化路线图

### Phase 1: 深度知识提取（增强现有索引）

**目标**：每篇书签不只是"摘要+标签"，而是结构化的知识条目。

#### 1.1 知识条目结构

```typescript
interface KnowledgeEntry {
  // 基础信息
  bookmarkId: string;
  url: string;
  title: string;
  
  // 结构化知识
  summary: string;           // 2-3句摘要
  quickSummary: string;      // 一句话精华
  keyPoints: string[];       // 核心要点
  concepts: Concept[];       // 提取的概念
  claims: Claim[];           // 核心论点
  dataPoints: DataPoint[];   // 关键数据/引用
  technologies: string[];    // 技术栈
  
  // 阅读元数据
  contentType: ContentType;  // 内容类型
  difficulty: DifficultyLevel;
  readingTime: number;       // 预估阅读时间
  language: string;          // 原文语言
}

interface Concept {
  name: string;              // 概念名称
  definition: string;        // 简短定义
  category: string;          // 分类（技术/理论/方法论）
  relatedConcepts: string[]; // 相关概念
}

interface Claim {
  text: string;              // 论点内容
  confidence: "high" | "medium" | "low";
  source: string;            // 原文引用
}

interface DataPoint {
  fact: string;              // 事实/数据
  context: string;           // 上下文
}
```

#### 1.2 LLM Prompt 增强

```typescript
const KNOWLEDGE_EXTRACTION_PROMPT = `分析以下内容，提取结构化知识。

输出 JSON:
{
  "summary": "2-3句摘要",
  "quickSummary": "一句话精华（15字以内）",
  "keyPoints": ["要点1", "要点2", ...],
  "concepts": [
    {
      "name": "概念名",
      "definition": "简短定义",
      "category": "技术|理论|方法论|工具",
      "relatedConcepts": ["相关概念1", ...]
    }
  ],
  "claims": [
    {
      "text": "核心论点",
      "confidence": "high|medium|low",
      "source": "原文引用或出处"
    }
  ],
  "dataPoints": [
    {
      "fact": "关键数据或事实",
      "context": "上下文说明"
    }
  ],
  "technologies": ["技术1", ...],
  "contentType": "article|repo|tweet|doc|video|tool|other",
  "difficulty": "beginner|intermediate|advanced",
  "readingTime": 5,
  "language": "zh|en|ja|ko"
}

内容类型指南:
- 项目仓库: 重点提取功能特性、技术架构、使用场景
- 技术文章: 重点提取核心论点、技术原理、实践经验
- 文档: 重点提取API设计、配置选项、最佳实践
- 推文: 重点提取观点、引用、讨论`;
```

---

### Phase 2: 概念级知识图谱

**目标**：从"标签图谱"进化为"概念图谱"，自动发现知识间的深层关联。

#### 2.1 概念存储

```typescript
// IndexedDB 新增表
interface ConceptRecord {
  id: string;                // 概念唯一ID (hash of name)
  name: string;              // 概念名称
  definition: string;        // 定义
  category: string;          // 分类
  embedding: number[];       // 概念向量
  occurrences: {             // 出现记录
    bookmarkId: string;
    context: string;         // 在该书签中的上下文
  }[];
  relatedConcepts: string[]; // 关联概念ID
  firstSeen: number;         // 首次出现时间
  lastSeen: number;          // 最近出现时间
  frequency: number;         // 出现频率
}

interface ConceptRelation {
  sourceId: string;
  targetId: string;
  relationType: "extends" | "contradicts" | "related" | "implements" | "cites";
  strength: number;          // 关联强度 0-1
  evidence: string[];        // 关联证据（书签ID列表）
}
```

#### 2.2 概念提取流程

```
书签索引完成
    ↓
LLM 提取 concepts[]
    ↓
对每个 concept:
  1. 生成 embedding
  2. 在已有概念库中搜索相似概念
  3. 如果是新概念 → 创建 ConceptRecord
  4. 如果是已有概念 → 更新 occurrences
  5. 计算 concept relations
    ↓
更新知识图谱
```

#### 2.3 概念图谱可视化

```typescript
// 概念图谱节点
interface ConceptNode {
  id: string;
  label: string;
  category: string;
  size: number;              // 基于 frequency
  color: string;             // 基于 category
  definition: string;
}

// 概念图谱边
interface ConceptEdge {
  source: string;
  target: string;
  type: string;
  strength: number;
  label: string;
}
```

---

### Phase 3: 每日知识简报

**目标**：每天自动生成"今日所学"摘要，帮助知识沉淀。

#### 3.1 简报结构

```typescript
interface DailyDigest {
  date: string;              // YYYY-MM-DD
  generatedAt: number;
  
  // 统计
  stats: {
    pagesIndexed: number;    // 今日新增索引
    readingTime: number;     // 预估阅读时间
    domains: string[];       // 涉及域名
  };
  
  // 核心洞察
  headlineInsight: string;   // 一句话总结今日阅读主题
  
  // 新概念
  newConcepts: {
    name: string;
    definition: string;
    source: string;
    importance: "high" | "medium" | "low";
  }[];
  
  // 知识连接
  connections: {
    description: string;     // "你今天读的X和上周读的Y有关联"
    sourceA: string;         // 书签A
    sourceB: string;         // 书签B
    relation: string;        // 关联类型
  }[];
  
  // 待深入
  toExplore: {
    topic: string;
    reason: string;
    relatedBookmarks: string[];
  }[];
  
  // 今日书签列表
  bookmarks: {
    title: string;
    url: string;
    quickSummary: string;
    contentType: string;
  }[];
}
```

#### 3.2 生成时机

```typescript
// 在 background.ts 中
// 每天凌晨 5 点生成昨日简报
browser.alarms.create("daily-digest", {
  when: getNextDailyDigestTime(),
  periodInMinutes: 24 * 60,
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "daily-digest") {
    await generateDailyDigest();
  }
});

async function generateDailyDigest(): Promise<void> {
  const yesterday = getYesterdayRange();
  const bookmarks = await getBookmarksIndexedBetween(yesterday.start, yesterday.end);
  
  if (bookmarks.length === 0) return;
  
  // 提取新概念
  const newConcepts = await extractNewConcepts(bookmarks);
  
  // 发现知识连接
  const connections = await discoverConnections(bookmarks);
  
  // 生成简报
  const digest = await buildDigest(bookmarks, newConcepts, connections);
  
  // 存储
  await saveDailyDigest(digest);
  
  // 通知用户
  browser.notifications.create({
    type: "basic",
    title: "📚 今日知识简报已生成",
    message: `昨天你阅读了 ${bookmarks.length} 篇内容，发现 ${newConcepts.length} 个新概念`,
  });
}
```

---

### Phase 4: 偶遇式知识回忆（Serendipity）

**目标**：当你在浏览网页时，自动关联你过去读过的相关内容。

#### 4.1 工作原理

```
用户浏览网页
    ↓
Content Script 提取页面关键概念
    ↓
在知识库中搜索相关概念
    ↓
如果有强关联 → 显示侧边栏提示
    ↓
"你3个月前读过一篇关于 X 的文章，与当前页面相关"
```

#### 4.2 Content Script 增强

```typescript
// content.ts
interface SerendipityMatch {
  currentConcept: string;
  relatedBookmark: {
    title: string;
    url: string;
    quickSummary: string;
    readAt: number;
  };
  relation: string;
  strength: number;
}

// 监听页面加载
window.addEventListener("load", async () => {
  // 等待页面稳定
  await waitForPageStable(3000);
  
  // 提取页面关键概念（使用简单的关键词提取）
  const pageText = extractMainContent();
  const concepts = extractKeyConcepts(pageText);
  
  // 搜索知识库
  const matches = await searchKnowledgeBase(concepts);
  
  if (matches.length > 0) {
    // 显示侧边栏提示
    showSerendipitySidebar(matches);
  }
});
```

#### 4.3 侧边栏 UI

```tsx
function SerendipitySidebar({ matches }: { matches: SerendipityMatch[] }) {
  return (
    <aside class="fixed right-0 top-1/4 w-80 bg-white shadow-lg border-l p-4">
      <h3 class="font-semibold text-sm mb-3">
        💡 相关知识回忆
      </h3>
      <For each={matches}>
        {(match) => (
          <div class="mb-3 p-2 bg-gray-50 rounded">
            <p class="text-xs text-gray-500">
              {formatTimeAgo(match.relatedBookmark.readAt)}前你读过
            </p>
            <a 
              href={match.relatedBookmark.url}
              class="text-sm font-medium text-blue-600 hover:underline"
            >
              {match.relatedBookmark.title}
            </a>
            <p class="text-xs text-gray-600 mt-1">
              {match.relatedBookmark.quickSummary}
            </p>
            <p class="text-xs text-purple-600 mt-1">
              关联: {match.relation}
            </p>
          </div>
        )}
      </For>
    </aside>
  );
}
```

---

### Phase 5: 研究助手（Research Agent）

**目标**：从基础 RAG 进化为多步研究代理。

#### 5.1 研究流程

```
用户提出研究问题
    ↓
PLAN: 分解为子问题
    ↓
RECALL: 搜索内部知识库
    ↓
GAP: 识别知识空白
    ↓
EXTERNAL: 搜索外部资源（可选）
    ↓
SYNTHESIZE: 综合分析，识别共识与分歧
    ↓
WRITE: 生成带引用的研究报告
```

#### 5.2 研究报告结构

```typescript
interface ResearchReport {
  question: string;
  generatedAt: number;
  
  // 研究过程
  process: {
    subQuestions: string[];
    sourcesSearched: number;
    internalSources: number;
    externalSources: number;
  };
  
  // 核心发现
  findings: {
    summary: string;
    keyInsights: string[];
    consensus: string[];       // 多来源一致的观点
    divergences: string[];     // 来源间的分歧
  };
  
  // 引用
  citations: {
    id: number;
    title: string;
    url: string;
    excerpt: string;
    relevance: "high" | "medium" | "low";
  }[];
  
  // 建议深入
  furtherReading: {
    topic: string;
    reason: string;
  }[];
  
  // 完整报告（Markdown）
  report: string;
}
```

#### 5.3 研究 API

```typescript
// 消息类型
case "RESEARCH": {
  const { question, depth } = message;
  
  // Step 1: 分解问题
  const subQuestions = await decomposeQuestion(question);
  
  // Step 2: 搜索内部知识库
  const internalResults = await searchInternalKnowledge(subQuestions);
  
  // Step 3: 识别知识空白
  const gaps = identifyKnowledgeGaps(subQuestions, internalResults);
  
  // Step 4: 搜索外部（如果启用）
  let externalResults = [];
  if (depth === "deep" && gaps.length > 0) {
    externalResults = await searchExternal(gaps);
  }
  
  // Step 5: 综合分析
  const analysis = await synthesize(question, internalResults, externalResults);
  
  // Step 6: 生成报告
  const report = await generateReport(question, analysis);
  
  return { success: true, report };
}
```

---

## 三、技术实现要点

### 1. 数据库扩展

```typescript
// db.ts 新增表
class BookmarkDB extends Dexie {
  bookmarks!: Table<BookmarkRecord>;
  indexQueue!: Table<IndexQueueRecord>;
  
  // 新增
  concepts!: Table<ConceptRecord>;
  conceptRelations!: Table<ConceptRelation>;
  dailyDigests!: Table<DailyDigest>;
  researchReports!: Table<ResearchReport>;
}

// 版本升级
this.version(7).stores({
  bookmarks: "id, url, status, indexedAt, *tags, source",
  indexQueue: "bookmarkId",
  // 新增
  concepts: "id, name, category, *relatedConcepts, frequency",
  conceptRelations: "++id, sourceId, targetId, relationType",
  dailyDigests: "date",
  researchReports: "++id, generatedAt",
});
```

### 2. 向量存储扩展

```typescript
// 概念向量单独存储
const CONCEPT_INDEX_KEY = "orama_concept_index";

// 概念搜索引擎
const conceptSchema = {
  id: "string",
  name: "string",
  definition: "string",
  category: "string",
} as const;
```

### 3. 增量更新策略

```
书签索引完成
    ↓
提取 concepts
    ↓
对每个 concept:
  - 计算 embedding
  - 搜索相似 concepts
  - 更新/创建 ConceptRecord
  - 更新 relations
    ↓
概念图谱增量更新
```

---

## 四、实施优先级

### P0: 深度知识提取（1-2周）
- [ ] 增强 LLM Prompt，提取 concepts/claims/dataPoints
- [ ] 扩展 BookmarkRecord 存储结构化知识
- [ ] 更新 SummarizePanel 展示结构化内容

### P1: 概念知识图谱（2-3周）
- [ ] 新增 ConceptRecord 和 ConceptRelation 表
- [ ] 实现概念提取管线
- [ ] 重构图谱页面，从标签图谱→概念图谱
- [ ] 支持概念级搜索

### P2: 每日知识简报（1-2周）
- [ ] 实现简报生成逻辑
- [ ] 添加定时任务
- [ ] 创建简报展示页面
- [ ] 支持邮件/通知推送

### P3: 偶遇式知识回忆（2-3周）
- [ ] 增强 Content Script
- [ ] 实现页面概念提取
- [ ] 实现知识库匹配
- [ ] 创建侧边栏 UI

### P4: 研究助手（3-4周）
- [ ] 实现问题分解
- [ ] 实现多步检索
- [ ] 实现综合分析
- [ ] 实现报告生成

---

## 五、差异化定位

### WisMe.ai vs Flow Search

| 维度 | WisMe.ai | Flow Search |
|------|----------|-------------|
| **定位** | 商业 SaaS 服务 | 开源浏览器扩展 |
| **数据** | 云端存储 | 本地优先 |
| **隐私** | 加密传输+存储 | 完全本地，零上传 |
| **成本** | $14.50/月 | 免费（用户自备 API Key） |
| **扩展性** | 固定功能 | 开源可定制 |
| **同步** | 云端同步 | Gist/本地同步 |

### Flow Search 的独特价值

1. **隐私第一**：所有数据留在本地，适合对隐私敏感的用户
2. **完全控制**：开源代码，用户可以自定义任何功能
3. **零成本**：只需自备 API Key，无订阅费用
4. **离线可用**：核心功能不依赖网络
5. **可扩展**：支持自定义 LLM Provider、自定义 Prompt

---

## 六、总结

从"书签搜索"到"个人知识库"的进化路径：

```
书签收藏 → 内容索引 → 知识提取 → 概念关联 → 知识回忆 → 研究助手
   ↓           ↓           ↓           ↓           ↓           ↓
 Bookmark → Summary → Knowledge → Concept → Serendipity → Research
            + Tags     Entry      Graph      Engine       Agent
```

核心理念：
- **不是记录书签，而是积累知识**
- **不是搜索历史，而是发现关联**
- **不是被动收藏，而是主动回忆**
- **不是孤立条目，而是知识网络**

最终目标：让 Flow Search 成为用户的"第二大脑"——
你读过的每一篇文章、每一个项目，都会变成你知识体系的一部分，
在你需要的时候自动浮现，在你探索的时候提供支撑。
