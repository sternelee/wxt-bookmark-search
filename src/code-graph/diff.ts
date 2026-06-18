/**
 * Code Graph diff — detect changed files for incremental updates
 */

/** Summary of files changed in a diff */
export type DiffSummary = {
  added: string[];
  modified: string[];
  deleted: string[];
};

/** Parse git diff text into changed file categories */
export function parseGitDiff(diffText: string): DiffSummary {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  const lines = diffText.split("\n");
  for (const line of lines) {
    if (line.startsWith("A\t")) added.push(line.slice(2));
    else if (line.startsWith("M\t")) modified.push(line.slice(2));
    else if (line.startsWith("D\t")) deleted.push(line.slice(2));
  }

  return { added, modified, deleted };
}

/** Detect changed files in a repository.
 *  Stub: returns sentinel for full rebuild. Real implementation will
 *  fetch the GitHub diff API or extract from a content script. */
export async function detectChangedFiles(
  repoUrl: string,
  branch?: string,
): Promise<string[]> {
  void repoUrl;
  void branch;
  return ["__FULL_REBUILD__"];
}
