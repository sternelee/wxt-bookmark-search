import { Octokit } from "octokit";

/**
 * GitHub API 交互封装 - 使用 Octokit
 */

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
}

/** 获取所有加星仓库 - 支持流式分页回调 */
export async function fetchAllStarredRepos(
  token: string, 
  onPage?: (repos: GithubRepo[]) => Promise<void>,
  onProgress?: (totalCount: number) => void
): Promise<GithubRepo[]> {
  const octokit = new Octokit({ auth: token });
  const allRepos: GithubRepo[] = [];

  try {
    const iterator = octokit.paginate.iterator("GET /user/starred", {
      per_page: 100,
    });

    for await (const { data: repos } of iterator) {
      const mappedRepos: GithubRepo[] = (repos as any[]).map(repo => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        html_url: repo.html_url,
        language: repo.language,
      }));

      allRepos.push(...mappedRepos);

      // 如果提供了 onPage 回调，立即处理这一页数据
      if (onPage) {
        await onPage(mappedRepos);
      }

      if (onProgress) onProgress(allRepos.length);

      if (allRepos.length >= 5000) break;
    }

    return allRepos;
  } catch (error) {
    console.error("[FlowSearch] Octokit fetch error:", error);
    throw error;
  }
}

/** 获取仓库 README 内容 */
export async function fetchRepoReadme(token: string, owner: string, repo: number | string): Promise<string | null> {
  const octokit = new Octokit({ auth: token });
  try {
    // 获取 README，Octokit 会自动处理 base64 解码 (通过 mediaType)
    const { data } = await octokit.rest.repos.getReadme({
      owner,
      repo: String(repo),
      mediaType: {
        format: "raw", // 直接获取原始文本
      },
    });
    
    return data as unknown as string;
  } catch (error) {
    console.warn(`[FlowSearch] Failed to fetch README for ${owner}/${repo}:`, error);
    return null;
  }
}

    throw error;
  }
}
