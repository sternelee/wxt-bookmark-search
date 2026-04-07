import { createSignal, onMount, For, Show } from "solid-js";
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

export default function FolderTree(props: FolderTreeProps) {
  const [folders, setFolders] = createSignal<Folder[]>([]);
  const [expandedIds, setExpandedIds] = createSignal<Set<string>>(new Set());

  onMount(async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: "GET_BOOKMARK_FOLDERS",
      }) as {
        success: boolean;
        folders?: Folder[];
        error?: string;
      };

      if (response.success && response.folders) {
        setFolders(response.folders);
      }
    } catch (error) {
      console.error("Failed to load folders:", error);
    }
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

  const renderFolder = (folder: Folder) => {
    const hasChildren = folder.children && folder.children.length > 0;
    const isExpanded = expandedIds().has(folder.id);
    const isChecked = props.selectedIds.includes(folder.id);

    return (
      <div>
        <div class="flex items-center py-1.5 px-2.5 rounded-lg hover:bg-accent transition-colors">
          {/* 展开/折叠按钮 */}
          <button
            class="w-5 h-5 border-none bg-transparent p-0 text-xs cursor-pointer flex items-center justify-center text-muted-foreground transition-transform"
            classList={{ "rotate-[-90deg]": !isExpanded }}
            onClick={() => toggleExpand(folder.id)}
            style={{ visibility: hasChildren ? "visible" : "hidden" }}
          >
            ▼
          </button>

          {/* 复选框 */}
          <Checkbox
            checked={isChecked}
            onChange={(e) => {
              // @ts-ignore
              handleCheck(folder.id, e.currentTarget.checked, hasChildren, folder.children);
            }}
            class="mr-2"
          />

          {/* 标签 */}
          <label class="flex-1 text-sm cursor-pointer">
            {folder.title}
          </label>
        </div>

        {/* 子文件夹 */}
        <Show when={hasChildren && isExpanded}>
          <div class="ml-5 border-l border-dashed border-border pl-1">
            <For each={folder.children}>
              {(child) => renderFolder(child)}
            </For>
          </div>
        </Show>
      </div>
    );
  };

  return (
    <div class="max-h-80 overflow-y-auto border border-border rounded-lg p-3 bg-background">
      <For each={folders()}>
        {(folder) => renderFolder(folder)}
      </For>
    </div>
  );
}
