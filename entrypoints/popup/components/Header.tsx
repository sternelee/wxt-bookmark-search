import StatusDot from "./StatusDot";

interface HeaderProps {
  isConfigured: boolean;
}

export default function Header(props: HeaderProps) {
  return (
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-2">
        <span class="text-lg bg-gradient-to-br from-primary to-pink-500 bg-clip-text text-transparent">
          ✨
        </span>
        <h1 class="text-lg font-bold tracking-tight">
          Flow Search
        </h1>
      </div>
      <StatusDot status={props.isConfigured ? "ready" : "not-configured"} />
    </div>
  );
}
