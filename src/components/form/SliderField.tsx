import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";

import { Slider, SliderFill, SliderThumb, SliderTrack } from "../ui/slider";
import { cn } from "../../lib/utils";

interface SliderFieldProps {
  value: number;
  onChange: (value: number) => void;
  label?: JSX.Element;
  hint?: JSX.Element;
  min?: number;
  max?: number;
  step?: number;
  /** Rendered after the current value, e.g. `%`. */
  valueSuffix?: string;
  disabled?: boolean;
  class?: string;
}

/**
 * Single-thumb slider with a label row and a live value readout.
 *
 * Kobalte models slider values as arrays; this wrapper keeps the scalar API the
 * settings panels expect while owning the track/fill/thumb composition.
 */
export function SliderField(props: SliderFieldProps) {
  const [local, others] = splitProps(props, ["label", "hint", "class", "valueSuffix"]);
  return (
    <div class={cn("grid gap-2", local.class)}>
      <div class="flex items-center justify-between gap-4">
        <Show when={local.label}>
          <span class="text-sm font-medium leading-none">{local.label}</span>
        </Show>
        <span class="text-xs tabular-nums text-muted-foreground">
          {props.value}
          {local.valueSuffix}
        </span>
      </div>
      <Slider
        {...others}
        value={[props.value]}
        onChange={(value) => props.onChange(value[0])}
        class="items-stretch"
      >
        <SliderTrack>
          <SliderFill />
          <SliderThumb />
        </SliderTrack>
      </Slider>
      <Show when={local.hint}>
        <span class="text-xs text-muted-foreground">{local.hint}</span>
      </Show>
    </div>
  );
}
