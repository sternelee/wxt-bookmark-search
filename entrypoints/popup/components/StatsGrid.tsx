import { Card, CardContent } from "../../../src/components/ui/card";
import { useI18n } from "../../../src/i18n";

interface StatsGridProps {
  indexed: number;
  total: number;
}

export default function StatsGrid(props: StatsGridProps) {
  const { t } = useI18n();
  return (
    <div class="grid grid-cols-2 gap-3 mb-5">
      <Card class="text-center hover:bg-accent/50 transition-colors">
        <CardContent class="p-3">
          <div class="text-xl font-extrabold text-primary">
            {props.indexed}
          </div>
          <div class="text-[11px] text-muted-foreground font-medium mt-1">
            {t("popup.aiIndexed")}
          </div>
        </CardContent>
      </Card>

      <Card class="text-center hover:bg-accent/50 transition-colors">
        <CardContent class="p-3">
          <div class="text-xl font-extrabold text-primary">
            {props.total}
          </div>
          <div class="text-[11px] text-muted-foreground font-medium mt-1">
            {t("popup.allBookmarks")}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
