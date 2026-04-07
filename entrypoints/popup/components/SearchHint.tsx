export default function SearchHint() {
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
        直接在地址栏搜索书签
      </p>
    </div>
  );
}
