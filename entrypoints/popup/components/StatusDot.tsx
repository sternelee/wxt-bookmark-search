import { cn } from "../../../src/lib/utils";

interface StatusDotProps {
  status: "ready" | "not-configured";
}

export default function StatusDot(props: StatusDotProps) {
  return (
    <div
      class={cn(
        "w-2 h-2 rounded-full relative",
        props.status === "ready"
          ? "bg-green-500"
          : "bg-yellow-500"
      )}
      title={props.status === "ready" ? "已配置" : "未配置"}
    >
      <div class="absolute inset-0 rounded-full border border-current opacity-30 scale-150" />
    </div>
  );
}
