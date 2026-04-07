import { splitProps, For } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../../lib/utils";

export interface SelectProps extends JSX.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  options: Array<{ value: string; label: string }>;
}

export function Select(props: SelectProps) {
  const [local, others] = splitProps(props, ["class", "label", "hint", "options"]);

  return (
    <div class="mb-5">
      {local.label && (
        <label class="block text-sm font-semibold mb-2 text-foreground">
          {local.label}
        </label>
      )}
      <select
        class={cn(
          "w-full px-4 py-3 border border-border rounded-lg text-sm bg-background text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          local.class
        )}
        {...others}
      >
        <For each={local.options}>
          {(option) => (
            <option value={option.value}>{option.label}</option>
          )}
        </For>
      </select>
      {local.hint && (
        <p class="text-xs text-muted-foreground mt-1.5">{local.hint}</p>
      )}
    </div>
  );
}
