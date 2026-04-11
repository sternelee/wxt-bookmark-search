/**
 * SiliconFlow Chat Completion API 封装
 * 用于生成网页摘要和标签
 */

export const DEFAULT_BASE_URL = 'https://api.siliconflow.cn';
export const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V3'; // 默认使用 DeepSeek 速度快且准确

const MAX_LLM_RETRIES = 2;
const LLM_RETRY_BASE_MS = 2000;

export interface AIResult {
  summary: string;
  tags: string[];
}

/** 判断 HTTP 状态码是否可重试 (429 限流 / 5xx 服务错误) */
function isRetryableLlmStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** 调用 LLM 生成摘要和标签，含指数退避重试 */
export async function generateDeepContent(
  text: string,
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseURL: string = DEFAULT_BASE_URL
): Promise<AIResult> {
  const systemPrompt = `You are a helpful bookmark assistant. Analyze the provided web content and return a JSON object containing:
1. 'summary': A 1-2 sentence concise summary in the original language of the text.
2. 'tags': 3-5 relevant keywords/tags in the original language of the text.

The output MUST be a valid JSON object. Example:
{
  "summary": "This article discusses React performance optimization techniques including useMemo and useCallback.",
  "tags": ["React", "Frontend", "Performance", "JavaScript"]
}`;

  const userPrompt = `Content to analyze:\n\n${text.slice(0, 4000)}`; // 截取前 4k 字符避免超长
  const endpoint = `${baseURL}/v1/chat/completions`;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        if (isRetryableLlmStatus(response.status) && attempt < MAX_LLM_RETRIES) {
          const delay = response.status === 429
            ? LLM_RETRY_BASE_MS * Math.pow(2, attempt)
            : LLM_RETRY_BASE_MS;
          console.warn(`[LLM] ${response.status} error, retrying in ${delay}ms (${attempt + 1}/${MAX_LLM_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`LLM API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      // 解析 JSON
      const result = JSON.parse(content) as AIResult;

      // 清理标签：去除引号、空格等
      result.tags = (result.tags || []).map((t: string) => t.trim()).filter(Boolean);
      return result;
    } catch (error: any) {
      // AbortError 及非重试错误直接失败
      if (error.name === 'AbortError' || attempt >= MAX_LLM_RETRIES) {
        console.error('[LLM] Failed to generate deep content:', error);
        break;
      }
      console.warn(`[LLM] Attempt ${attempt + 1} failed, retrying:`, error.message);
      await new Promise(r => setTimeout(r, LLM_RETRY_BASE_MS));
    }
  }

  // 降级处理：返回原始文本截取
  return {
    summary: text.slice(0, 200).trim() + '...',
    tags: [],
  };
}
