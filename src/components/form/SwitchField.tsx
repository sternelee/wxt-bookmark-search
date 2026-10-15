import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";

import { Switch, SwitchControl, SwitchLabel, SwitchThumb } from "../ui/switch";
import { cn } from "../../lib/utils";

interface SwitchFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: JSX.Element;
  hint?: JSX.Element;
  disabled?: boolean;
  class?: string;
}

/**
 * Boolean setting laid out as a row: label on the left, switch on the right.
 *
 * The vendored `Switch` root carries no styling of its own, so the row layout
 * lives here while the track stays with `SwitchControl`.
 */
export function SwitchField(props: SwitchFieldProps) {
  const [local, others] = splitProps(props, ["label", "hint", "class"]);
  return (
    <Switch class={cn("flex items-center justify-between gap-4", local.class)} {...others}>
      <span class="grid gap-1 leading-snug">
        <SwitchLabel class="text-sm font-medium">{local.label}</SwitchLabel>
        <Show when={local.hint}>
          <span class="text-xs font-normal text-muted-foreground">{local.hint}</span>
        </Show>
      </span>
      <SwitchControl>
        <SwitchThumb />
      </SwitchControl>
    </Switch>
  );
}
