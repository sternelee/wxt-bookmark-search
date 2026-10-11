/**
 * Jev (TypeSafe System One) 客户端 — LLM-as-judge 评审重排
 *
 * Jev 是 TypeSafe 的评估模型：一次请求携带 `state` 与一组结构化问题，
 * 返回每个问题的概率答案（noul = 概率，choice = 选项 + 置信度）。
 * superagents-lab/jev-search 用它做意图推断与搜索结果重排；这里复用其
 * 评审协议（{@link https://docs.typesafe.ai/api}），对本地召回的书签
 * 候选逐条评估「是否与查询相关」，再按概率重排。
 *
 * 纯逻辑模块：不依赖 browser.* / DOM，可在任意上下文使用。
 */

export interface JevConfig {
  apiKey: string;
  /** 默认 https://api.typesafe.ai/v1/systemone */
  baseURL?: string;
  /** 默认 jev-latest */
  model?: string;
}

export type JevQuestion =
  | {
      type: "noul";
      instructions: string;
      criteria?: { true?: string; false?: string };
    }
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string | null>;
    };

type JevAnswer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    };

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export class JevError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
/** 与 jev-search 保持一致：单批最多评审 40 条候选 */
export const JEV_RERANK_BATCH = 40;
const JEV_TIMEOUT_MS = 15_000;

function failureMessage(status: number): string {
  if (status >= 500) return "Jev is temporarily unavailable. Please try again shortly.";
  if (status === 429) return "Jev is receiving too many requests. Please try again shortly.";
  return `Jev could not process this request (HTTP ${status}).`;
}

/**
 * 调用 TypeSafe System One 评估端点
 * @param config Jev 配置（API Key 必填）
 * @param state 评审上下文（如 { request, results }），问题通过 `state` 字段引用
 * @param questions 问题表：id → 问题定义
 * @param signal 中止信号
 */
export async function jevSystemOne(
  config: JevConfig,
  state: unknown,
  questions: Record<string, JevQuestion>,
  signal?: AbortSignal,
): Promise<JevResponse> {
  const base = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  // 校验目标协议：Bearer Key 绝不能发往非 https 源（本地开发允许 http）
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new JevError(0, `Invalid jev base URL: ${base}`);
  }
  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && isLocalhost)
  ) {
    throw new JevError(
      0,
      `Jev base URL must use https:// (http:// allowed only for localhost): ${base}`,
    );
  }
  const model = config.model ?? DEFAULT_MODEL;
  const timeout = AbortSignal.timeout(JEV_TIMEOUT_MS);
  const finalSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state, model, questions }),
    signal: finalSignal,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new JevError(response.status, failureMessage(response.status));
  }

  const body = (await response.json()) as Partial<JevResponse>;
  const answers =
    typeof body.answers === "object" && body.answers !== null && !Array.isArray(body.answers)
      ? body.answers
      : {};
  return {
    model: body.model ?? model,
    answers,
    usage: {
      input_tokens: body.usage?.input_tokens ?? 0,
      output_tokens: body.usage?.output_tokens ?? 0,
    },
  };
}

/** 待评审的搜索候选 */
export interface JevRankItem {
  id: string;
  title: string;
  snippet: string;
  source?: string;
}

/**
 * 评审每条候选「是否与 request 相关」，返回 id → 概率 (0..1)。
 * 超过 40 条自动分批并行评审；某条缺答案时跳过不计分。
 * 部分批次失败时：失败批次的候选不计分（下游按 0 分兜底），
 * 仅当所有批次都失败时才向上抛出第一个错误，让调用方走兜底逻辑。
 */
export async function jevRerank(
  config: JevConfig,
  request: string,
  items: JevRankItem[],
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (items.length === 0) return scores;

  const batches: JevRankItem[][] = [];
  for (let i = 0; i < items.length; i += JEV_RERANK_BATCH) {
    batches.push(items.slice(i, i + JEV_RERANK_BATCH));
  }

  const responses = await Promise.allSettled(
    batches.map((batch) => {
      const questions: Record<string, JevQuestion> = {};
      batch.forEach((_, i) => {
        questions[`r${i}`] = {
          type: "noul",
          instructions: `Is \`results[${i}]\` about the subject the user asked for in \`request\`?`,
          criteria: {
            true: "The title or snippet discusses the same subject the user asked about, even briefly or as one of several topics",
            false: "The result is about something else that only shares words with the request (a different meaning of the same word, a different product, a person with the same name) or is unrelated",
          },
        };
      });
      const state = {
        request,
        results: batch.map((it) => ({
          source: it.source ?? "",
          title: it.title,
          snippet: it.snippet,
        })),
      };
      return jevSystemOne(config, state, questions, signal);
    }),
  );

  let failed = 0;
  let firstError: unknown;
  let missing = 0;
  responses.forEach((res, b) => {
    if (res.status === "rejected") {
      failed += 1;
      if (firstError === undefined) firstError = res.reason;
      return;
    }
    batches[b]!.forEach((item, i) => {
      const answer = res.value.answers[`r${i}`];
      const raw = answer?.type === "noul" ? answer.noul : undefined;
      const score =
        typeof raw === "number" && Number.isFinite(raw)
          ? Math.min(1, Math.max(0, raw))
          : undefined;
      if (score === undefined) {
        missing += 1;
        return;
      }
      scores.set(item.id, score);
    });
  });
  if (missing > 0) {
    console.warn("[jev] incomplete answers:", missing, "of", items.length, "candidates unscored");
  }
  // 所有批次都失败：视为整体失败，让调用方的兜底逻辑生效
  if (failed === batches.length) {
    throw firstError;
  }

  return scores;
}
