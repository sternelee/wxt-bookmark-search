/**
 * Cross-browser bookmark root mapping helpers.
 *
 * Chrome and Firefox expose different root ids/titles for their built-in top-level
 * bookmark containers. We normalize them to semantic roles so Gist restore can map:
 * - Chrome "Bookmarks bar" <-> Firefox "Bookmarks Toolbar"
 * - Chrome "Other bookmarks" <-> Firefox "Unfiled/Other Bookmarks"
 * - Firefox "Bookmarks Menu" -> Chrome fallback "Other bookmarks"
 */
export type BookmarkRootRole = "toolbar" | "other" | "menu" | "mobile";

export interface BookmarkRootCandidate {
  id?: string;
  title?: string;
  url?: string;
}

const TOOLBAR_ROOT_LABELS = [
  "bookmarksbar",
  "bookmarkbar",
  "bookmarkstoolbar",
  "toolbar",
  "书签栏",
  "书签工具栏",
  "ブックマークバー",
  "ブックマークツールバー",
  "북마크바",
  "북마크도구모음",
];

const OTHER_ROOT_LABELS = [
  "otherbookmarks",
  "unfiledbookmarks",
  "其他书签",
  "その他のブックマーク",
  "기타북마크",
];

const MENU_ROOT_LABELS = [
  "bookmarksmenu",
  "bookmarkmenu",
  "书签菜单",
  "ブックマークメニュー",
  "북마크메뉴",
];

const MOBILE_ROOT_LABELS = [
  "mobilebookmarks",
  "移动设备书签",
  "モバイルのブックマーク",
  "모바일북마크",
];

function normalizeBookmarkRootLabel(value: string): string {
  return value.toLowerCase().replace(/[\s_\-()（）]/g, "");
}

/** Infer the semantic role of a browser bookmark root from its id or localized title. */
export function detectBookmarkRootRole(
  input: BookmarkRootCandidate | string,
): BookmarkRootRole | undefined {
  const id = typeof input === "string" ? "" : (input.id || "").toLowerCase();
  const title = normalizeBookmarkRootLabel(
    typeof input === "string" ? input : input.title || "",
  );

  if (id.includes("toolbar")) return "toolbar";
  if (id.includes("unfiled")) return "other";
  if (id.includes("menu")) return "menu";
  if (id.includes("mobile")) return "mobile";

  if (TOOLBAR_ROOT_LABELS.includes(title)) return "toolbar";
  if (OTHER_ROOT_LABELS.includes(title)) return "other";
  if (MENU_ROOT_LABELS.includes(title)) return "menu";
  if (MOBILE_ROOT_LABELS.includes(title)) return "mobile";

  return undefined;
}

/** Pick the best writable default root for a target browser. */
export function getPreferredBookmarkRoot<T extends BookmarkRootCandidate>(
  rootChildren: T[],
  preferredRoles: BookmarkRootRole[] = ["toolbar", "other", "menu", "mobile"],
): T | undefined {
  for (const role of preferredRoles) {
    const match = rootChildren.find(
      (item) => !item.url && detectBookmarkRootRole(item) === role,
    );
    if (match) {
      return match;
    }
  }

  return rootChildren.find((item) => !item.url);
}

/**
 * Resolve a serialized root label from Gist into the closest native root in the
 * current browser.
 *
 * Special case: Firefox "Bookmarks Menu" has no Chrome-native counterpart, so we
 * intentionally fall back to Chrome's "Other bookmarks" root.
 */
export function resolveBookmarkRootFolder<T extends BookmarkRootCandidate>(
  rootChildren: T[],
  rootLabel: string,
): T | undefined {
  const targetRole = detectBookmarkRootRole(rootLabel);
  if (targetRole) {
    const directMatch = rootChildren.find(
      (item) => !item.url && detectBookmarkRootRole(item) === targetRole,
    );
    if (directMatch) {
      return directMatch;
    }

    if (targetRole === "menu") {
      const otherMatch = rootChildren.find(
        (item) => !item.url && detectBookmarkRootRole(item) === "other",
      );
      if (otherMatch) {
        return otherMatch;
      }
    }
  }

  return rootChildren.find((item) => !item.url && item.title === rootLabel);
}
