import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";

import { TextField, TextFieldDescription, TextFieldInput, TextFieldLabel } from "../ui/text-field";
import { cn } from "../../lib/utils";

interface InputFieldProps {
  value: string | number;
  onChange: (value: string) => void;
  label?: JSX.Element;
  hint?: JSX.Element;
  /** 仅允许受控的 input 类型（Kobalte 的 `type` 不接受任意字符串） */
  type?: "text" | "password" | "email" | "url" | "number" | "search" | "tel" | "date" | "time";
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  onBlur?: () => void;
  "aria-label"?: string;
}

/**
 * Labelled text input backed by the shadcn-solid `TextField` primitive.
 *
 * Restores the ergonomic `label` / `hint` / `onChange(value)` shape the settings
 * panels already used, so call sites stay readable while the underlying control
 * is the vendored Kobalte component.
 */
export function InputField(props: InputFieldProps) {
  const [local, others] = splitProps(props, [
    "value",
    "onChange",
    "label",
    "hint",
    "type",
    "class",
    "disabled",
    "onBlur",
  ]);

  return (
    <TextField
      {...others}
      value={local.value === undefined ? "" : String(local.value)}
      onChange={local.onChange}
      disabled={local.disabled}
      class={cn("flex flex-col gap-2", local.class)}
    >
      <Show when={local.label}>
        <TextFieldLabel class="text-sm font-semibold text-foreground">{local.label}</TextFieldLabel>
      </Show>
      <TextFieldInput
        type={local.type || "text"}
        disabled={local.disabled}
        onBlur={local.onBlur}
      />
      <Show when={local.hint}>
        <TextFieldDescription class="text-xs text-muted-foreground">{local.hint}</TextFieldDescription>
      </Show>
    </TextField>
  );
}
