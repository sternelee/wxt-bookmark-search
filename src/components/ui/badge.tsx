import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../../lib/utils";

export interface BadgeProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline";
}

export function Badge(props: BadgeProps) {
  const [local, others] = splitProps(props, ["class", "variant"]);

  const variants: Record<string, string> = {
    default: "bg-primary text-primary-foreground hover:bg-primary/80",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/80",
    outline: "text-foreground border",
  };

  return (
    <div
      class={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        variants[local.variant || "default"],
        local.class
      )}
      {...others}
    />
  );
}
