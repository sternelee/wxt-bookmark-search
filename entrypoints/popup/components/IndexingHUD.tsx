import { Card, CardContent } from "../../../src/components/ui/card";
import { Progress } from "../../../src/components/ui/progress";

interface IndexingHUDProps {
  progress: {
    processed: number;
    total: number;
    status: string;
  };
}

export default function IndexingHUD(props: IndexingHUDProps) {
  const percentage = () => {
    return Math.round(
      (props.progress.processed / (props.progress.total || 1)) * 100
    );
  };

  return (
    <Card class="mb-5 shadow-md">
      <CardContent class="p-3">
        <div class="flex justify-between text-[11px] font-bold text-primary mb-2">
          <span>⚡ 正在同步索引...</span>
          <span>{percentage()}%</span>
        </div>
        <Progress value={percentage()} class="h-1.5" />
      </CardContent>
    </Card>
  );
}
