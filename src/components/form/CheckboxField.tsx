import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";

import { Checkbox } from "../ui/checkbox";
import { cn } from "../../lib/utils";

interface CheckboxFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: JSX.Element;
  hint?: JSX.Element;
  disabled?: boolean;
  class?: string;
}

/**
 * Checkbox with an inline label and an optional muted hint.
 *
 * Thin ergonomic wrapper over the shadcn-solid `Checkbox` primitive: callers pass
 * a plain `label`/`hint` instead of composing the primitive's children by hand.
 */
export function CheckboxField(props: CheckboxFieldProps) {
  const [local, others] = splitProps(props, ["label", "hint", "class"]);
  return (
    <Checkbox class={cn("items-start gap-2.5 space-x-0", local.class)} {...others}>
      <span class="grid gap-1 leading-snug">
        <span class="text-sm font-medium">{local.label}</span>
        <Show when={local.hint}>
          <span class="text-xs font-normal text-muted-foreground">{local.hint}</span>
        </Show>
      </span>
    </Checkbox>
  );
}
