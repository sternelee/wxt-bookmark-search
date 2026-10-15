import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../../lib/utils";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: JSX.Element;
  hint?: JSX.Element;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
}

/**
 * Labelled single-select backed by the shadcn-solid `Select` primitive.
 *
 * Callers pass plain `{ value, label }` options and receive the chosen value as a
 * string, so the Kobalte `options` + `itemComponent` wiring stays in one place.
 */
export function SelectField(props: SelectFieldProps) {
  const [local, others] = splitProps(props, [
    "label",
    "hint",
    "class",
    "options",
    "placeholder",
    "value",
    "onChange",
    "disabled",
  ]);
  const selected = () => local.options.find((option) => option.value === local.value) ?? null;

  return (
    <div class={cn("grid gap-2", local.class)}>
      <Show when={local.label}>
        <span class="text-sm font-medium leading-none">{local.label}</span>
      </Show>
      <Select<SelectOption>
        {...others}
        value={selected()}
        onChange={(option) => local.onChange(option?.value ?? "")}
        options={local.options}
        optionValue="value"
        optionTextValue="label"
        placeholder={local.placeholder}
        disabled={local.disabled}
        disallowEmptySelection
        itemComponent={(itemProps) => (
          <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>
        )}
        {...others}
      >
        <SelectTrigger>
          <SelectValue<SelectOption>>
            {(state) => (
              <span class="truncate">{state.selectedOption()?.label ?? local.placeholder}</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
      <Show when={local.hint}>
        <span class="text-xs text-muted-foreground">{local.hint}</span>
      </Show>
    </div>
  );
}
