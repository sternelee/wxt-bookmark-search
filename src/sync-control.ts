/**
 * 外部数据源同步的中止控制（GitHub Stars / Twitter 书签 / 浏览器历史）
 *
 * 纯逻辑模块：不依赖 browser.* 与任何框架，浏览器 API 由 entrypoints 侧注入。
 * 每次同步开始时登记一个 AbortController，停止请求会 abort 对应的 signal；
 * 同步循环检查 signal.aborted 后在最近的安全边界收尾（不写入半成品数据）。
 */

/** 可中止的外部数据源同步类型 */
export type SyncSource = "github" | "twitter" | "history";

/** 正在进行的同步：source -> 该次运行的中止控制器 */
const runningSyncs = new Map<SyncSource, AbortController>();

/**
 * 开始一次同步，返回该次运行的中止信号。
 * 同一数据源若已有同步在跑，会先中止旧的，避免两次同步并发写库。
 */
export function beginSync(source: SyncSource): AbortSignal {
  runningSyncs.get(source)?.abort();
  const controller = new AbortController();
  runningSyncs.set(source, controller);
  return controller.signal;
}

/**
 * 结束一次同步。
 * 仅当它仍是最新一次运行时才清理登记，避免误删之后新发起的同步。
 */
export function endSync(source: SyncSource, signal: AbortSignal): void {
  if (runningSyncs.get(source)?.signal === signal) {
    runningSyncs.delete(source);
  }
}

/**
 * 请求停止某数据源的同步。
 * 返回 true 表示确有同步在跑且已被中止；false 表示当前没有该数据源的同步。
 */
export function stopSync(source: SyncSource): boolean {
  const controller = runningSyncs.get(source);
  if (!controller) return false;
  controller.abort();
  runningSyncs.delete(source);
  return true;
}

/** 判断来自消息通道的值是否为合法的同步来源 */
export function isSyncSource(value: unknown): value is SyncSource {
  return value === "github" || value === "twitter" || value === "history";
}

/** 判断某数据源当前是否有同步正在进行（供定时任务避免打断手动同步） */
export function isSyncRunning(source: SyncSource): boolean {
  return runningSyncs.has(source);
}
