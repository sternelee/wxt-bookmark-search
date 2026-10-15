/**
 * CSS-based tag cloud component
 * Font size and opacity respond to tag weight and active state
 */
import { For, Show } from "solid-js";
import { useI18n } from "../../../src/i18n";
import type { TagNode } from "../../../src/tag-cloud";
import { Skeleton } from "../../../src/components/ui/skeleton";
import { cn } from "../../../src/lib/utils";

/** 标签按主题着色映射 */
const TAG_COLORS: Record<string, string> = {
  // 语言/框架
  rust: "hsl(15, 85%, 55%)",
  javascript: "hsl(50, 85%, 55%)",
  typescript: "hsl(220, 80%, 60%)",
  python: "hsl(200, 70%, 55%)",
  go: "hsl(190, 65%, 50%)",
  java: "hsl(25, 80%, 50%)",
  kotlin: "hsl(280, 60%, 60%)",
  swift: "hsl(15, 70%, 50%)",
  // 框架
  react: "hsl(195, 80%, 60%)",
  vue: "hsl(145, 65%, 45%)",
  angular: "hsl(0, 60%, 50%)",
  svelte: "hsl(15, 85%, 55%)",
  nextjs: "hsl(0, 0%, 20%)",
  nuxt: "hsl(145, 65%, 45%)",
  // 领域
  ai: "hsl(280, 70%, 60%)",
  ml: "hsl(280, 70%, 60%)",
  llm: "hsl(280, 70%, 60%)",
  devops: "hsl(165, 55%, 45%)",
  docker: "hsl(200, 60%, 50%)",
  kubernetes: "hsl(200, 60%, 50%)",
  linux: "hsl(200, 50%, 50%)",
  // 数据库
  database: "hsl(30, 70%, 50%)",
  postgresql: "hsl(220, 50%, 55%)",
  mongodb: "hsl(130, 50%, 45%)",
  redis: "hsl(15, 70%, 50%)",
};

function getTagColor(tag: string): string {
  const normalized = tag.toLowerCase();
  for (const [key, color] of Object.entries(TAG_COLORS)) {
    if (normalized.includes(key)) return color;
  }
  // 动态计算一个柔和的颜色（基于 tag 字符串 hash）
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}

interface TagCloudProps {
  nodes: TagNode[];
  activeTags: string[];
  onTagClick: (tag: string) => void;
  isLoading?: boolean;
  hasFilter?: boolean;
}

export function TagCloud(props: TagCloudProps) {
  const { t } = useI18n();

  // 字号: min 12px ~ max 32px，按 weight 线性插值
  const fontSize = (weight: number) => {
    const base = 12;
    const range = 20;
    return `${base + weight * range}px`;
  };

  // 权重 → 透明度
  const opacity = (tag: string): number => {
    if (props.activeTags.length === 0) return 1;
    return props.activeTags.includes(tag) ? 1 : 0.4;
  };

  // 粗体阈值
  const fontWeight = (weight: number) => {
    if (weight > 0.65) return "700";
    if (weight > 0.3) return "500";
    return "400";
  };

  return (
    <div class="relative flex h-full w-full items-center justify-center overflow-hidden p-6">
      {/* 加载骨架：用一排脉冲胶囊模拟标签云的形状 */}
      <Show when={props.isLoading}>
        <div class="absolute inset-0 z-10 flex flex-wrap content-center items-center justify-center gap-3 bg-background/70 backdrop-blur-[1px]">
          <For each={[72, 96, 60, 120, 84, 64, 104, 76]}>
            {(w, i) => (
              <Skeleton
                class="h-8 rounded-full"
                style={{ width: `${w}px`, "animation-delay": `${i() * 90}ms` }}
              />
            )}
          </For>
        </div>
      </Show>

      <div class="flex min-h-[280px] flex-wrap items-center justify-center gap-2.5">
        <For each={props.nodes}>
          {(node) => {
            const color = getTagColor(node.tag);
            const isActive = () => props.activeTags.includes(node.tag);
            return (
              <button
                type="button"
                class={cn(
                  "tag-item cursor-pointer select-none rounded-full border px-3 py-1.5",
                  "transition-all duration-300 ease-out hover:scale-110 hover:shadow-lg",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive() && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                )}
                style={{
                  "font-size": fontSize(node.weight),
                  "font-weight": fontWeight(node.weight),
                  color,
                  "border-color": `${color}59`,
                  opacity: opacity(node.tag),
                  "letter-spacing": node.weight > 0.5 ? "0.02em" : "normal",
                  background: `${color}1f`,
                }}
                title={t("search.graphTagCount", { count: node.count })}
                onClick={() => props.onTagClick(node.tag)}
              >
                {node.tag}
              </button>
            );
          }}
        </For>
      </div>

      {/* 空状态 */}
      <Show when={!props.isLoading && props.nodes.length === 0}>
        <div class="absolute inset-0 flex items-center justify-center">
          <p class="max-w-xs text-center text-sm text-muted-foreground">
            <Show
              when={props.hasFilter}
              fallback={
                <>
                  {t("search.graphNoMoreTags")}
                  <span class="mt-1 block text-xs">{t("search.graphTryOtherTags")}</span>
                </>
              }
            >
              {t("search.graphNoMatchingTags")}
            </Show>
          </p>
        </div>
      </Show>
    </div>
  );
}
