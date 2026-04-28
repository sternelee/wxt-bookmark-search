/**
 * Twitter/X GraphQL API 客户端
 * 用于获取用户书签
 */

import type { BookmarkRecord } from "./types";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const X_PUBLIC_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const BOOKMARKS_QUERY_ID = "Z9GWmP0kP2dajyckAaDUBw";
const BOOKMARKS_OPERATION = "Bookmarks";

const GRAPHQL_FEATURES = {
  graphql_timeline_v2_bookmark_timeline: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_uc_gql_enabled: true,
  vibe_api_enabled: true,
  responsive_web_text_conversations_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  responsive_web_media_download_video_enabled: false,
};

export interface TwitterBookmark {
  tweetId: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string;
  bookmarkedAt?: string;
  engagement?: {
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    bookmarkCount?: number;
    viewCount?: number;
    quoteCount?: number;
  };
  media?: string[];
  quotedTweetId?: string;
  quotedTweetText?: string;
  links?: string[];
}

export interface TwitterSyncOptions {
  csrfToken: string;
  authToken: string;
  cursor?: string;
  maxPages?: number;
  onProgress?: (page: number, total: number) => void;
}

/**
 * 构建 GraphQL API URL
 */
function buildUrl(cursor?: string): string {
  const variables: Record<string, unknown> = { count: 20 };
  if (cursor) variables.cursor = cursor;
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(GRAPHQL_FEATURES),
  });
  return `https://x.com/i/api/graphql/${BOOKMARKS_QUERY_ID}/${BOOKMARKS_OPERATION}?${params}`;
}

/**
 * 构建请求头
 */
function buildHeaders(
  csrfToken: string,
  authToken: string,
): Record<string, string> {
  return {
    authorization: `Bearer ${X_PUBLIC_BEARER}`,
    "x-csrf-token": csrfToken,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "content-type": "application/json",
    "user-agent": CHROME_UA,
    cookie: `ct0=${csrfToken}; auth_token=${authToken}`,
  };
}

/**
 * 解析推文数据为 TwitterBookmark
 * 使用防御性访问，任意必填字段缺失时跳过该推文
 */
function parseTweetData(tweetResult: any): TwitterBookmark | null {
  if (!tweetResult || typeof tweetResult !== "object") return null;

  const tweet = tweetResult.tweet ?? tweetResult;
  const legacy = tweet?.legacy;
  if (!legacy || typeof legacy !== "object") return null;

  const tweetId = legacy.id_str ?? tweet?.rest_id;
  if (!tweetId || typeof tweetId !== "string") return null;

  const userResult = tweet?.core?.user_results?.result;
  const authorHandle =
    userResult?.core?.screen_name ??
    userResult?.legacy?.screen_name ??
    undefined;
  const authorName =
    userResult?.core?.name ?? userResult?.legacy?.name ?? undefined;
  const authorProfileImageUrl =
    userResult?.avatar?.image_url ??
    userResult?.legacy?.profile_image_url_https ??
    userResult?.legacy?.profile_image_url ??
    undefined;

  // 提取媒体
  const mediaEntities: any[] =
    legacy?.extended_entities?.media ?? legacy?.entities?.media ?? [];
  const media: string[] = Array.isArray(mediaEntities)
    ? mediaEntities
        .map((m: any) => m?.media_url_https ?? m?.media_url)
        .filter((u): u is string => typeof u === "string")
    : [];

  // 提取链接
  const urlEntities: any[] = legacy?.entities?.urls ?? [];
  const links: string[] = Array.isArray(urlEntities)
    ? urlEntities
        .map((u: any) => u?.expanded_url)
        .filter(
          (u): u is string => typeof u === "string" && !u.includes("t.co"),
        )
    : [];

  // 提取引用推文
  const quotedResult = tweet?.quoted_status_result?.result;
  let quotedTweetId: string | undefined;
  let quotedTweetText: string | undefined;

  if (quotedResult && typeof quotedResult === "object") {
    const qtTweet = quotedResult.tweet ?? quotedResult;
    const qtLegacy = qtTweet?.legacy;
    if (qtLegacy && typeof qtLegacy === "object") {
      quotedTweetId =
        typeof qtLegacy.id_str === "string"
          ? qtLegacy.id_str
          : qtTweet?.rest_id;
      const qtNoteTweetText =
        qtTweet?.note_tweet?.note_tweet_results?.result?.text;
      quotedTweetText =
        qtNoteTweetText ?? qtLegacy.full_text ?? qtLegacy.text ?? "";
    }
  }

  // X Articles / long-form note tweets
  const noteTweetText = tweet?.note_tweet?.note_tweet_results?.result?.text;
  const text = noteTweetText ?? legacy.full_text ?? legacy.text ?? "";
  if (typeof text !== "string") return null;

  return {
    tweetId,
    text,
    authorHandle,
    authorName,
    authorProfileImageUrl,
    postedAt:
      typeof legacy.created_at === "string" ? legacy.created_at : undefined,
    engagement: {
      likeCount:
        typeof legacy.favorite_count === "number"
          ? legacy.favorite_count
          : undefined,
      repostCount:
        typeof legacy.retweet_count === "number"
          ? legacy.retweet_count
          : undefined,
      replyCount:
        typeof legacy.reply_count === "number" ? legacy.reply_count : undefined,
      quoteCount:
        typeof legacy.quote_count === "number" ? legacy.quote_count : undefined,
      bookmarkCount:
        typeof legacy.bookmark_count === "number"
          ? legacy.bookmark_count
          : undefined,
      viewCount:
        tweet?.views?.count != null ? Number(tweet.views.count) : undefined,
    },
    media,
    quotedTweetId,
    quotedTweetText,
    links,
  };
}

/**
 * 解析 GraphQL 响应
 */
function parseBookmarksResponse(response: any): {
  bookmarks: TwitterBookmark[];
  cursor?: string;
  hasMore: boolean;
} {
  const instructions =
    response?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [];
  const entries: any[] = [];

  for (const instruction of instructions) {
    if (
      instruction.type === "TimelineAddEntries" &&
      Array.isArray(instruction.entries)
    ) {
      entries.push(...instruction.entries);
    }
  }

  const bookmarks: TwitterBookmark[] = [];
  let cursor: string | undefined;
  let hasMore = false;

  for (const entry of entries) {
    // 提取游标
    if (entry.entryId?.startsWith("cursor-bottom-")) {
      cursor = entry.content?.value;
      hasMore = true;
    }

    // 解析推文
    if (entry.entryId?.startsWith("tweet-")) {
      const tweetResult = entry.content?.itemContent?.tweet_results?.result;
      if (tweetResult) {
        const bookmark = parseTweetData(tweetResult);
        if (bookmark) {
          bookmarks.push(bookmark);
        }
      }
    }
  }

  return { bookmarks, cursor, hasMore };
}

/**
 * 带重试的 fetch
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 4,
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      const waitSec = Math.min(15 * Math.pow(2, attempt), 120);
      console.warn(`[twitter] 速率限制，等待 ${waitSec}s`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error("Cookie 已过期，请重新登录 Twitter");
    }

    if (response.status >= 500) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }

    return response;
  }

  throw new Error("超过最大重试次数");
}

/**
 * 获取 Twitter 书签
 */
export async function fetchTwitterBookmarks(
  options: TwitterSyncOptions,
): Promise<{
  bookmarks: TwitterBookmark[];
  cursor?: string;
  hasMore: boolean;
}> {
  const url = buildUrl(options.cursor);
  const headers = buildHeaders(options.csrfToken, options.authToken);

  const response = await fetchWithRetry(url, { headers });

  if (!response.ok) {
    throw new Error(
      `Twitter API 错误: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  return parseBookmarksResponse(data);
}

/**
 * 转换为 BookmarkRecord
 */
export function convertToBookmarkRecord(
  bookmark: TwitterBookmark,
  embedding?: number[],
): BookmarkRecord {
  return {
    id: `tw-${bookmark.tweetId}`,
    url: `https://x.com/${bookmark.authorHandle || "i"}/status/${bookmark.tweetId}`,
    title: `@${bookmark.authorHandle || "unknown"}`,
    summary: bookmark.text,
    embedding,
    status: embedding ? "indexed" : "pending",
    indexedAt: embedding ? Date.now() : undefined,
    tweetId: bookmark.tweetId,
    authorHandle: bookmark.authorHandle,
    authorName: bookmark.authorName,
    authorProfileImageUrl: bookmark.authorProfileImageUrl,
    postedAt: bookmark.postedAt,
    engagement: bookmark.engagement,
    media: bookmark.media,
    quotedTweetId: bookmark.quotedTweetId,
    quotedTweetText: bookmark.quotedTweetText,
  };
}
