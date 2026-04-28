import { splitProps, Show } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../../lib/utils";

export interface AlertProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: "success" | "error" | "info";
  visible?: boolean;
}

export function Alert(props: AlertProps) {
  const [local, others] = splitProps(props, [
    "class",
    "variant",
    "visible",
    "children",
  ]);

  const variants = {
    success:
      "bg-green-50 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-800",
    error:
      "bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800",
    info: "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800",
  };

  return (
    <Show when={local.visible !== false}>
      <div
        class={cn(
          "p-3.5 rounded-lg text-sm font-medium border flex items-center gap-2.5",
          variants[local.variant || "info"],
          local.class,
        )}
        {...others}
      >
        {local.children}
      </div>
    </Show>
  );
}
