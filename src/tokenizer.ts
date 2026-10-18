/**
 * CJK 感知的 Orama 分词器
 *
 * Orama 默认英文分词器按非字母数字切分，中日韩文字会被整段丢弃，
 * 导致中文标题的书签永远无法被关键词搜索命中（实测：中文查询恒为空）。
 *
 * 策略：
 * - CJK 连续段（汉字/假名/韩文音节）→ 二元组（bigram），孤立单字保留单字 token。
 *   查询 "浏览器" 切为 ["浏览","览器"]，与文档端 bigram 对齐命中（Lucene CJK 同款思路）。
 * - 拉丁词（含数字）→ 小写原词 + 轻量词干变体（去 's/s/es/ed/ing/ies 后缀），
 *   补偿丢失的英文 stemmer，保持 "closures" ↔ "closure" 这类召回。
 */

/** Orama Tokenizer 结构类型（包入口未导出该接口，按 types.d.ts 定义结构声明） */
export interface OramaTokenizer {
  language: string;
  normalizationCache: Map<string, string>;
  tokenize: (
    raw: string,
    language?: string,
    prop?: string,
    withCache?: boolean,
  ) => string[];
}

/** 汉字（含扩展A/兼容）、日文假名、韩文音节 */
const CJK_CHAR =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/** 连续 CJK 段 或 连续拉丁词（允许词内撇号，如 don't） */
const TOKEN_RUN =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+|[a-z0-9]+(?:'[a-z]+)?/g;

/** 轻量英文词干：返回去后缀变体，无适用规则时返回 null */
function lightStem(word: string): string | null {
  const len = word.length;
  if (len > 4 && word.endsWith("'s")) return word.slice(0, -2);
  if (len > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (len > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (len > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (len > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (len > 3 && word.endsWith("s")) return word.slice(0, -1);
  return null;
}

/** 将文本切分为检索 token（索引端与查询端共用，保证对齐） */
export function tokenizeSearchText(raw: string): string[] {
  if (typeof raw !== "string") return [raw];
  const tokens: string[] = [];
  for (const match of raw.toLowerCase().matchAll(TOKEN_RUN)) {
    const run = match[0];
    if (CJK_CHAR.test(run[0])) {
      if (run.length === 1) {
        tokens.push(run);
      } else {
        for (let i = 0; i < run.length - 1; i++) {
          tokens.push(run.slice(i, i + 2));
        }
      }
    } else {
      tokens.push(run);
      const stem = lightStem(run);
      if (stem && stem !== run) tokens.push(stem);
    }
  }
  return tokens;
}

/**
 * 构造 Orama 自定义 tokenizer 组件。
 * 必须在 create() 时通过 components.tokenizer 传入（不可与顶层 language 同用）。
 */
export function createCjkTokenizer(): OramaTokenizer {
  return {
    language: "cjk-aware",
    normalizationCache: new Map<string, string>(),
    tokenize: (raw: string) => tokenizeSearchText(raw),
  };
}
