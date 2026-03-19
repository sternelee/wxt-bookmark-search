export interface ChromeBookmark {
  id: string;
  title: string;
  url: string | null; // folder nodes have null URL
  dateAdded?: number;
}

export interface OmniboxSuggestion {
  content: string;
  description: string;
}
