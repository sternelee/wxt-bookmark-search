import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../../lib/utils";

export interface SliderProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  valueDisplay?: string;
}

export function Slider(props: SliderProps) {
  const [local, others] = splitProps(props, ["class", "label", "hint", "valueDisplay"]);

  return (
    <div class="mb-5">
      {local.label && (
        <label class="block text-sm font-semibold mb-2 text-foreground">
          {local.label}
        </label>
      )}
      <div class="flex items-center gap-4 p-4">
        <input
          type="range"
          class={cn(
            "flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer",
            "accent-primary",
            local.class
          )}
          {...others}
        />
        {local.valueDisplay && (
          <span class="text-base font-bold text-primary min-w-[45px] text-right">
            {local.valueDisplay}
          </span>
        )}
      </div>
      {local.hint && (
        <p class="text-xs text-muted-foreground mt-1.5">{local.hint}</p>
      )}
    </div>
  );
}
