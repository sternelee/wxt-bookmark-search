import { Card, CardContent } from "../../../src/components/ui/card";
import { Progress } from "../../../src/components/ui/progress";
import { useI18n } from "../../../src/i18n";

interface IndexingHUDProps {
  progress: {
    processed: number;
    total: number;
    status: string;
  };
}

export default function IndexingHUD(props: IndexingHUDProps) {
  const { t } = useI18n();
  const percentage = () => {
    if (props.progress.total <= 0) return 0;
    return Math.round((props.progress.processed / props.progress.total) * 100);
  };

  return (
    <Card class="border-primary/40 bg-primary/5">
      <CardContent class="flex flex-col gap-2 p-3">
        <div class="flex items-baseline justify-between gap-2 text-[11px] font-semibold text-primary">
          <span class="truncate">{t("popup.indexing")}</span>
          <span class="shrink-0 tabular-nums">
            {props.progress.processed}/{props.progress.total} · {percentage()}%
          </span>
        </div>
        <Progress value={percentage()} class="h-1.5" />
      </CardContent>
    </Card>
  );
}
