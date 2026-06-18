/**
 * GitHub repository content fetcher — 用于 Code Wiki 构建
 *
 * 通过 Octokit REST API 拉取仓库默认分支的目录树与文件原始内容。
 * 支持可选的 PAT（settings.githubToken）以提升速率限制。
 */
import { Octokit } from "octokit";
import { getSettings } from "../db";

/** 支持的源码扩展名（与 parser 保持一致） */
const SOURCE_EXTS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "rb",
  "php",
  "cs",
  "swift",
  "scala",
  "cpp",
  "c",
  "h",
  "hpp",
]);

/** 仓库大小上限（默认 5MB 原始内容） */
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
/** 单文件大小上限（默认 500KB） */
const MAX_FILE_BYTES = 500 * 1024;
/** 最大文件数（避免大仓库一次性下载） */
const MAX_FILES = 2000;

/** 解析后的 GitHub 仓库信息 */
export interface GitHubRepoRef {
  owner: string;
  repo: string;
  branch: string;
  /** 规范化 URL（用于存储） */
  repoUrl: string;
}

/**
 * 解析 GitHub URL/字符串为 owner/repo/branch。
 * 支持：https://github.com/owner/repo、https://github.com/owner/repo/tree/branch、
 *       git@github.com:owner/repo.git、owner/repo
 */
export function parseGitHubUrl(input: string): GitHubRepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // SSH: git@github.com:owner/repo.git
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed);
  if (ssh) {
    return {
      owner: ssh[1],
      repo: ssh[2],
      branch: "main",
      repoUrl: `https://github.com/${ssh[1]}/${ssh[2]}`,
    };
  }

  // HTTPS: https://github.com/owner/repo[.git][/tree|blob/branch]
  const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:[\/?#].*)?$/.exec(
    trimmed,
  );
  if (https) {
    const owner = https[1];
    const repo = https[2];
    // Try to extract branch from path: /tree/branch or /blob/branch
    const branchMatch = /[/?#](?:tree|blob)\/([^/?#]+)/.exec(trimmed);
    const branch = branchMatch ? decodeURIComponent(branchMatch[1]) : "main";
    return { owner, repo, branch, repoUrl: `https://github.com/${owner}/${repo}` };
  }

  // Short form: owner/repo
  const short = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  if (short) {
    return {
      owner: short[1],
      repo: short[2],
      branch: "main",
      repoUrl: `https://github.com/${short[1]}/${short[2]}`,
    };
  }

  return null;
}

/** Tree entry from GitHub */
interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  url: string;
}

/** 仓库树（递归） */
export interface RepoFileEntry {
  path: string;
  size: number;
}

/** Get an Octokit client using settings PAT (if available). */
async function getOctokit(): Promise<Octokit> {
  const settings = await getSettings();
  const auth = settings.githubToken || undefined;
  return new Octokit({
    auth,
    userAgent: "flow-search-code-wiki",
    request: { fetch },
  });
}

/**
 * 获取仓库默认分支 SHA。
 */
async function getDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string> {
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return data.default_branch;
}

/**
 * 列出仓库所有源码文件（递归）。
 * 使用 git trees API with recursive=1 一次拿全树。
 * @throws Error on rate limit or auth failure
 */
export async function listRepoFiles(
  ref: GitHubRepoRef,
  options: {
    onProgress?: (msg: string) => void;
  } = {},
): Promise<RepoFileEntry[]> {
  const { owner, repo, branch } = ref;
  const octokit = await getOctokit();
  const actualBranch = branch || (await getDefaultBranch(octokit, owner, repo));
  options.onProgress?.(`Resolving tree for ${owner}/${repo}@${actualBranch}...`);

  // 1) Get the tree SHA for the branch HEAD
  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${actualBranch}`,
  });
  const commitSha = refData.object.sha;

  // 2) Get recursive tree
  const { data: treeData } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: "true",
  });

  if (treeData.truncated) {
    console.warn(
      "[github] tree response truncated by GitHub; consider using GitHub API for partial updates",
    );
  }

  // 3) Filter to source files
  const files: RepoFileEntry[] = [];
  let totalBytes = 0;
  for (const entry of treeData.tree as TreeEntry[]) {
    if (entry.type !== "blob") continue;
    const ext = entry.path.split(".").pop()?.toLowerCase() || "";
    if (!SOURCE_EXTS.has(ext)) continue;
    if (entry.size && entry.size > MAX_FILE_BYTES) {
      console.warn(`[github] skipping oversized file: ${entry.path} (${entry.size}B)`);
      continue;
    }
    if (totalBytes + (entry.size ?? 0) > MAX_TOTAL_BYTES) {
      console.warn(
        `[github] total size budget exhausted, skipping remaining files`,
      );
      break;
    }
    if (files.length >= MAX_FILES) {
      console.warn(`[github] file count cap reached (${MAX_FILES})`);
      break;
    }
    files.push({ path: entry.path, size: entry.size ?? 0 });
    totalBytes += entry.size ?? 0;
  }

  return files;
}

/**
 * 并发获取多个文件的内容。返回 { path, content, skipped } 三元组；
 * 失败的或跳过的文件不会 throw，调用方拿到 skipped 自行决定如何处理。
 */
export async function fetchFileContents(
  ref: GitHubRepoRef,
  filePaths: string[],
  options: {
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ path: string; content: string }[]> {
  const { owner, repo, branch } = ref;
  const octokit = await getOctokit();
  const concurrency = 6;
  const results: { path: string; content: string }[] = [];
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (cursor < filePaths.length) {
      if (options.signal?.aborted) return;
      const idx = cursor++;
      const path = filePaths[idx];
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
          ref: branch,
        });
        if (Array.isArray(data) || data.type !== "file") {
          done++;
          options.onProgress?.(done, filePaths.length);
          continue;
        }
        if (data.encoding !== "base64" || !data.content) {
          done++;
          options.onProgress?.(done, filePaths.length);
          continue;
        }
        // Decode base64 → utf-8
        const binary = atob(data.content.replace(/\n/g, ""));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        results.push({ path, content });
      } catch (e) {
        console.warn(
          `[github] failed to fetch ${path}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
      done++;
      options.onProgress?.(done, filePaths.length);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

/**
 * 拉取 GitHub 仓库全部源码：列表 + 内容，一站式入口。
 * 进度通过 onProgress 回调报告。
 */
export async function fetchRepoSource(
  ref: GitHubRepoRef,
  options: {
    onProgress?: (msg: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ path: string; content: string }[]> {
  const files = await listRepoFiles(ref, {
    onProgress: options.onProgress,
  });
  options.onProgress?.(`Found ${files.length} source files. Downloading...`);
  const contents = await fetchFileContents(
    ref,
    files.map((f) => f.path),
    {
      onProgress: (done, total) => {
        if (done % 5 === 0 || done === total) {
          options.onProgress?.(`Downloaded ${done}/${total} files...`);
        }
      },
      signal: options.signal,
    },
  );
  options.onProgress?.(`Downloaded ${contents.length} files.`);
  return contents;
}
