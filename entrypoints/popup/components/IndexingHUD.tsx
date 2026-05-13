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
    return Math.round(
      (props.progress.processed / props.progress.total) * 100
    );
  };

  return (
    <Card class="mb-5 shadow-md">
      <CardContent class="p-3">
        <div class="flex justify-between text-[11px] font-bold text-primary mb-2">
          <span>{t("popup.indexing")}</span>
          <span>{percentage()}%</span>
        </div>
        <Progress value={percentage()} class="h-1.5" />
      </CardContent>
    </Card>
  );
}
