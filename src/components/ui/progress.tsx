import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../../lib/utils";

export interface ProgressProps extends JSX.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

export function Progress(props: ProgressProps) {
  const [local, others] = splitProps(props, ["class", "value"]);

  return (
    <div
      class={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        local.class
      )}
      {...others}
    >
      <div
        class="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (local.value || 0)}%)` }}
      />
    </div>
  );
}
