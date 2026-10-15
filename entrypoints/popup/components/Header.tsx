import { useI18n } from "../../../src/i18n";
import { Badge } from "../../../src/components/ui/badge";

interface HeaderProps {
  isConfigured: boolean;
}

export default function Header(props: HeaderProps) {
  const { t } = useI18n();
  return (
    <header class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-pink-500 text-sm shadow-sm">
          ✨
        </span>
        <h1 class="text-base font-bold tracking-tight">{t("popup.title")}</h1>
      </div>
      <Badge
        variant={props.isConfigured ? "success" : "warning"}
        class="shrink-0 gap-1.5 pl-1.5"
        title={props.isConfigured ? t("common.configured") : t("common.notConfigured")}
      >
        <span
          class={
            "size-1.5 rounded-full " +
            (props.isConfigured ? "bg-emerald-500" : "bg-amber-500")
          }
        />
        {props.isConfigured ? t("common.configured") : t("common.notConfigured")}
      </Badge>
    </header>
  );
}
