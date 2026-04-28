import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../../lib/utils";

export interface SeparatorProps extends JSX.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}

export function Separator(props: SeparatorProps) {
  const [local, others] = splitProps(props, [
    "class",
    "orientation",
    "decorative",
  ]);

  return (
    <div
      role={local.decorative ? "none" : "separator"}
      aria-orientation={local.orientation}
      class={cn(
        "shrink-0 bg-border",
        local.orientation === "vertical" ? "h-full w-[1px]" : "h-[1px] w-full",
        local.class,
      )}
      {...others}
    />
  );
}
