import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../../lib/utils";

export interface CheckboxProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export function Checkbox(props: CheckboxProps) {
  const [local, others] = splitProps(props, [
    "class",
    "label",
    "hint",
    "checked",
  ]);

  return (
    <div class={cn(local.class)}>
      <label class="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          class={cn(
            "w-4 h-4 rounded border-border text-primary",
            "focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
          {...others}
        />
        {local.label && (
          <span class="text-sm font-medium text-foreground">{local.label}</span>
        )}
      </label>
      {local.hint && (
        <p class="text-xs text-muted-foreground mt-1 ml-6">{local.hint}</p>
      )}
    </div>
  );
}
