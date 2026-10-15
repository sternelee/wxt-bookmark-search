import { Card, CardContent } from "../../../src/components/ui/card";
import { Progress } from "../../../src/components/ui/progress";
import { useI18n } from "../../../src/i18n";

interface StatsGridProps {
  indexed: number;
  total: number;
}

export default function StatsGrid(props: StatsGridProps) {
  const { t } = useI18n();
  const percentage = () => {
    if (props.total <= 0) return 0;
    return Math.round((props.indexed / props.total) * 100);
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="grid grid-cols-2 gap-2.5">
        <Card class="transition-colors hover:bg-accent/50">
          <CardContent class="p-3">
            <div class="text-xl font-extrabold tabular-nums text-primary">{props.indexed}</div>
            <div class="mt-0.5 text-[11px] font-medium text-muted-foreground">
              {t("popup.aiIndexed")}
            </div>
          </CardContent>
        </Card>

        <Card class="transition-colors hover:bg-accent/50">
          <CardContent class="p-3">
            <div class="text-xl font-extrabold tabular-nums">{props.total}</div>
            <div class="mt-0.5 text-[11px] font-medium text-muted-foreground">
              {t("popup.allBookmarks")}
            </div>
          </CardContent>
        </Card>
      </div>

      <div class="flex items-center gap-2 px-0.5">
        <Progress value={percentage()} class="h-1.5 flex-1" />
        <span class="w-9 shrink-0 text-right text-[10px] font-medium tabular-nums text-muted-foreground">
          {percentage()}%
        </span>
      </div>
    </div>
  );
}
