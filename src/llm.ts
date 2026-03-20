/**
 * SiliconFlow Chat Completion API 封装
 * 用于生成网页摘要和标签
 */

const API_ENDPOINT = 'https://api.siliconflow.cn/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V3'; // 默认使用 DeepSeek 速度快且准确

export interface AIResult {
  summary: string;
  tags: string[];
}

/** 调用 LLM 生成摘要和标签 */
export async function generateDeepContent(
  text: string,
  apiKey: string,
  model: string = DEFAULT_MODEL
): Promise<AIResult> {
  // 构建提示词
  const systemPrompt = `You are a helpful bookmark assistant. Analyze the provided web content and return a JSON object containing:
1. 'summary': A 1-2 sentence concise summary in the original language of the text.
2. 'tags': 3-5 relevant keywords/tags in the original language of the text.

The output MUST be a valid JSON object. Example:
{
  "summary": "This article discusses React performance optimization techniques including useMemo and useCallback.",
  "tags": ["React", "Frontend", "Performance", "JavaScript"]
}`;

  const userPrompt = `Content to analyze:\n\n${text.slice(0, 4000)}`; // 截取前 4k 字符避免超长

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // 解析 JSON
    const result = JSON.parse(content) as AIResult;
    
    // 清理标签：去除引号、空格等
    result.tags = (result.tags || []).map(t => t.trim()).filter(Boolean);
    
    return result;
  } catch (error) {
    console.error('[LLM] Failed to generate deep content:', error);
    // 降级处理：返回原始数据
    return {
      summary: text.slice(0, 200).trim() + '...',
      tags: []
    };
  }
}
