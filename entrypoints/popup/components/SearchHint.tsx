import { useI18n } from "../../../src/i18n";

export default function SearchHint() {
  const { t } = useI18n();
  return (
    <div class="text-center mb-5">
      <div class="flex justify-center gap-1 mb-2">
        <kbd class="px-2 py-0.5 text-xs font-semibold bg-muted border border-border rounded">
          bi
        </kbd>
        <span class="text-muted-foreground">+</span>
        <kbd class="px-2 py-0.5 text-xs font-semibold bg-muted border border-border rounded">
          Space
        </kbd>
      </div>
      <p class="text-xs text-muted-foreground">
        {t("popup.searchHint")}
      </p>
    </div>
  );
}
