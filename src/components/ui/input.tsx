import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../../lib/utils";

export interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Input(props: InputProps) {
  const [local, others] = splitProps(props, ["class", "label", "hint", "error", "type"]);

  return (
    <div class="mb-5">
      {local.label && (
        <label class="block text-sm font-semibold mb-2 text-foreground">
          {local.label}
        </label>
      )}
      <input
        type={local.type || "text"}
        class={cn(
          "w-full px-4 py-3 border border-border rounded-lg text-sm bg-background text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "placeholder:text-muted-foreground",
          local.error && "border-destructive",
          local.class
        )}
        {...others}
      />
      {local.hint && !local.error && (
        <p class="text-xs text-muted-foreground mt-1.5">{local.hint}</p>
      )}
      {local.error && (
        <p class="text-xs text-destructive mt-1.5">{local.error}</p>
      )}
    </div>
  );
}
