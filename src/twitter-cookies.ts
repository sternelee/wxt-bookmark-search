/**
 * Twitter/X Cookie 提取工具
 * 使用 Chrome 扩展的 cookies API 直接获取 cookies
 */

export interface TwitterCookies {
  ct0: string;
  authToken: string;
}

/**
 * 从 Twitter/X 域名提取必要的 cookies
 */
export async function extractTwitterCookies(): Promise<TwitterCookies | null> {
  try {
    // 获取 ct0 cookie (CSRF token)
    const ct0Cookie = await browser.cookies.get({
      url: "https://x.com",
      name: "ct0",
    });

    // 获取 auth_token cookie
    const authTokenCookie = await browser.cookies.get({
      url: "https://x.com",
      name: "auth_token",
    });

    if (!ct0Cookie || !ct0Cookie.value) {
      console.error("[twitter-cookies] 未找到 ct0 cookie");
      return null;
    }

    if (!authTokenCookie || !authTokenCookie.value) {
      console.error("[twitter-cookies] 未找到 auth_token cookie");
      return null;
    }

    return {
      ct0: ct0Cookie.value,
      authToken: authTokenCookie.value,
    };
  } catch (error) {
    console.error("[twitter-cookies] Cookie 提取失败:", error);
    return null;
  }
}

/**
 * 验证 cookies 是否有效（通过测试 API 调用）
 */
export async function testTwitterCookies(cookies: TwitterCookies): Promise<boolean> {
  try {
    const response = await fetch("https://x.com/i/api/1.1/account/verify_credentials.json", {
      headers: {
        authorization: `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`,
        "x-csrf-token": cookies.ct0,
        cookie: `ct0=${cookies.ct0}; auth_token=${cookies.authToken}`,
      },
    });

    return response.ok || response.status === 429; // 429 表示 cookies 有效但被限流
  } catch (error) {
    console.error("[twitter-cookies] Cookie 测试失败:", error);
    return false;
  }
}
