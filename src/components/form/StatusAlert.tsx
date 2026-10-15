import { Show } from "solid-js";

import { Alert } from "../ui/alert";
import { cn } from "../../lib/utils";

/** Shape the settings panels use for their inline save / sync feedback. */
interface StatusMessage {
  message: string;
  type: "success" | "error" | "info" | "warning";
}

interface StatusAlertProps {
  status: StatusMessage | null;
  class?: string;
}

/**
 * Renders a panel's status message as a semantic alert, or nothing when idle.
 *
 * Replaces the `variant` + `visible` + children triple the panels used to spell out
 * by hand: the alert is only mounted when there is something to say.
 */
export function StatusAlert(props: StatusAlertProps) {
  return (
    <Show when={props.status}>
      {(status) => (
        <Alert variant={status().type} class={cn("mt-4", props.class)}>
          {status().message}
        </Alert>
      )}
    </Show>
  );
}

export type { StatusMessage };
