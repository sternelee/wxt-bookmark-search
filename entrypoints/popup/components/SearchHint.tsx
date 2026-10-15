import { useI18n } from "../../../src/i18n";

export default function SearchHint() {
  const { t } = useI18n();
  return (
    <div class="flex flex-col items-center gap-1.5">
      <div class="flex items-center gap-1 text-[11px]">
        <kbd class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          bi
        </kbd>
        <span class="text-muted-foreground">+</span>
        <kbd class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          Space
        </kbd>
      </div>
      <p class="text-center text-[11px] leading-snug text-muted-foreground">
        {t("popup.searchHint")}
      </p>
    </div>
  );
}
