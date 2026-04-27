import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { Checkbox } from "../../../src/components/ui/checkbox";

interface Folder {
  id: string;
  title: string;
  path: string;
  children?: Folder[];
}

interface FolderTreeProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function FolderItem(props: {
  folder: Folder;
  selectedIds: string[];
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onCheck: (id: string, checked: boolean, hasChildren: boolean, children?: Folder[]) => void;
}) {
  const hasChildren = () => props.folder.children && props.folder.children.length > 0;
  const isExpanded = () => props.expandedIds.has(props.folder.id);
  const isChecked = () => props.selectedIds.includes(props.folder.id);

  return (
    <div>
      <div class="flex items-center py-1.5 px-2.5 rounded-lg hover:bg-accent transition-colors">
        {/* 展开/折叠按钮 */}
        <button
          class="w-5 h-5 border-none bg-transparent p-0 text-xs cursor-pointer flex items-center justify-center text-muted-foreground transition-transform"
          classList={{ "rotate-[-90deg]": !isExpanded() }}
          onClick={() => props.onToggleExpand(props.folder.id)}
          style={{ visibility: hasChildren() ? "visible" : "hidden" }}
        >
          ▼
        </button>

        {/* 复选框 */}
        <Checkbox
          checked={isChecked()}
          onChange={(e) => {
            // @ts-ignore
            props.onCheck(props.folder.id, e.currentTarget.checked, hasChildren(), props.folder.children);
          }}
          class="mr-2"
        />

        {/* 标签 */}
        <label class="flex-1 text-sm cursor-pointer">
          {props.folder.title}
        </label>
      </div>

      {/* 子文件夹 */}
      <Show when={hasChildren() && isExpanded()}>
        <div class="ml-5 border-l border-dashed border-border pl-1">
          <For each={props.folder.children}>
            {(child) => (
              <FolderItem
                folder={child}
                selectedIds={props.selectedIds}
                expandedIds={props.expandedIds}
                onToggleExpand={props.onToggleExpand}
                onCheck={props.onCheck}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function FolderTree(props: FolderTreeProps) {
  const [folders, setFolders] = createSignal<Folder[]>([]);
  const [expandedIds, setExpandedIds] = createSignal<Set<string>>(new Set());

  const collectFolderIds = (items: Folder[]): Set<string> => {
    const ids = new Set<string>();

    const visit = (nodes: Folder[]) => {
      nodes.forEach((node) => {
        ids.add(node.id);
        if (node.children) {
          visit(node.children);
        }
      });
    };

    visit(items);
    return ids;
  };

  const loadFolders = async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: "GET_BOOKMARK_FOLDERS",
      }) as {
        success: boolean;
        folders?: Folder[];
        error?: string;
      };

      if (!response.success || !response.folders) {
        return;
      }

      setFolders(response.folders);

      const validFolderIds = collectFolderIds(response.folders);
      const nextExpandedIds = new Set(
        [...expandedIds()].filter((id) => validFolderIds.has(id)),
      );
      setExpandedIds(nextExpandedIds);

      const nextSelectedIds = props.selectedIds.filter((id) => validFolderIds.has(id));
      if (nextSelectedIds.length !== props.selectedIds.length) {
        props.onChange(nextSelectedIds);
        await saveSettings({ selectedFolderIds: nextSelectedIds });
      }
    } catch (error) {
      console.error("Failed to load folders:", error);
    }
  };

  onMount(async () => {
    await loadFolders();

    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        loadFolders();
      }, 200);
    };

    browser.bookmarks.onCreated.addListener(scheduleReload);
    browser.bookmarks.onRemoved.addListener(scheduleReload);
    browser.bookmarks.onMoved.addListener(scheduleReload);
    browser.bookmarks.onChanged.addListener(scheduleReload);

    onCleanup(() => {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      browser.bookmarks.onCreated.removeListener(scheduleReload);
      browser.bookmarks.onRemoved.removeListener(scheduleReload);
      browser.bookmarks.onMoved.removeListener(scheduleReload);
      browser.bookmarks.onChanged.removeListener(scheduleReload);
    });
  });

  const toggleExpand = (id: string) => {
    const newSet = new Set(expandedIds());
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedIds(newSet);
  };

  const handleCheck = (id: string, checked: boolean, hasChildren: boolean, children?: Folder[]) => {
    let newSelected = [...props.selectedIds];

    if (checked) {
      newSelected.push(id);
      // 如果有子节点，也选中所有子节点
      if (hasChildren && children) {
        const collectChildIds = (items: Folder[]) => {
          items.forEach(item => {
            newSelected.push(item.id);
            if (item.children) {
              collectChildIds(item.children);
            }
          });
        };
        collectChildIds(children);
      }
    } else {
      // 移除当前节点
      newSelected = newSelected.filter(fid => fid !== id);
      // 如果有子节点，也移除所有子节点
      if (hasChildren && children) {
        const collectChildIds = (items: Folder[]) => {
          items.forEach(item => {
            newSelected = newSelected.filter(fid => fid !== item.id);
            if (item.children) {
              collectChildIds(item.children);
            }
          });
        };
        collectChildIds(children);
      }
    }

    props.onChange(newSelected);

    // 实时保存
    saveSettings({ selectedFolderIds: newSelected });
  };

  async function saveSettings(settings: any) {
    const { saveSettings: save } = await import("../../../src/db");
    await save(settings);
  }

  return (
    <div class="max-h-80 overflow-y-auto border border-border rounded-lg p-3 bg-background">
      <For each={folders()}>
        {(folder) => (
          <FolderItem
            folder={folder}
            selectedIds={props.selectedIds}
            expandedIds={expandedIds()}
            onToggleExpand={toggleExpand}
            onCheck={handleCheck}
          />
        )}
      </For>
    </div>
  );
}
