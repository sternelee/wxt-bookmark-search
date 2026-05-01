export default {
  common: {
    save: "💾 保存",
    saving: "保存中...",
    test: "⚡ 接続テスト",
    testing: "テスト中...",
    sync: "🔄 今すぐ同期",
    syncing: "同期中...",
    upload: "⬆️ アップロード",
    uploading: "アップロード中...",
    download: "⬇️ ダウンロード",
    downloading: "ダウンロード中...",
    create: "📤 新規 Gist 作成",
    creating: "作成中...",
    link: "🔗 連携",
    linking: "連携中...",
    confirm: "実行確認",
    cancel: "キャンセル",
    delete: "🗑️ ブックマーク削除",
    start: "🚀 全量/増分インデックス開始",
    startFolder: "🚀 選択した {{count}} 個のフォルダをインデックス",
    pause: "⏸️ 一時停止",
    resume: "▶️ 再開",
    retry: "🔄 失敗を再試行",
    clearCache: "🧹 キャッシュ削除",
    clearQueryCache: "🧹 クエリキャッシュ削除",
    clearDatabase: "🗑️ データベース削除",
    apply: "✨ 検索戦略を適用",
    yes: "はい",
    no: "いいえ",
    total: "合計",
    indexed: "インデックス済",
    pending: "待機中",
    failed: "失敗",
    lastSync: "最終同期",
    notConfigured: "未設定",
    configured: "設定済",
    search: "検索",
    searching: "検索中...",
    error: "エラー",
    unknownError: "不明なエラー",
    close: "閉じる",
    language: "言語設定",
    dataManagement: "データ管理",
  },

  popup: {
    title: "Flow Search",
    quickSearchPlaceholder: "ブックマークを検索...",
    manageSettings: "インデックスと設定を管理",
    goConfigure: "API キーを設定",
    recentlyVisited: "最近アクセス",
    aiIndexed: "AI インデックス済",
    allBookmarks: "すべてのブックマーク",
    indexing: "⚡ インデックス構築中...",
    searchHint: "アドレスバーに bi <キーワード> と入力してブックマークを検索",
    poweredBy: "Powered by OpenAI & Jina AI",
  },

  options: {
    pageTitle: "設定",
    appTitle: "🤖 Flow Search",

    api: {
      title: "🔑 API 設定",
      apiKeyHint: "OpenAI、SiliconFlow、Azure OpenAI など互換 API に対応",
      baseURL: "API ベース URL",
      baseURLHint: "API ベース URL、デフォルト: https://api.openai.com/v1",
      embeddingModel: "Embedding モデル",
      embeddingModelHint:
        "デフォルト: text-embedding-3-small (1536次元ベクトル)",
      llmModel: "LLM モデル",
      llmModelHint: "デフォルト: gpt-4o-mini (要約とタグ生成用)",
      enableLLM: "LLM コンテンツ強化を有効化",
      enableLLMHint: "LLM を使用して要約とタグを生成し、検索品質を向上",
      advanced: "詳細設定",
      apiKeyRequired: "API キーを入力してください",
      saved: "✓ 設定を保存しました",
      testSuccess: "✓ API キーは有効です、接続成功",
      testFail: "✗ API キーが無効です",
    },

    search: {
      title: "🔍 検索戦略",
      mode: "検索モード",
      modeHint:
        "ハイブリッド検索はキーワードの精度と AI の意味理解を組み合わせます",
      modeHybrid: "ハイブリッド検索 (推奨)",
      modeVector: "ベクトル検索のみ",
      modeKeyword: "キーワード一致 (クラシック)",
      vectorWeight: "ベクトル検索ウェイト",
      vectorWeightHint:
        "値を上げると意味的な類似性が重視されます。下げると文字列一致が重視されます",
      applied: "✓ 検索設定を適用しました",
    },

    github: {
      title: "🐙 GitHub Stars セマンティックインデックス",
      tokenHint:
        "GitHub Stars の同期には starred repos の読み取りが必要です。下記の Gist ブックマーク同期を有効にする場合は gist 権限も必要です。",
      saveSettings: "GitHub 設定を保存",
      syncStars: "Stars を今すぐ同期",
      syncingStars: "Stars を取得中...",
      syncSuccess:
        "✓ 同期成功！{{total}} 個のリポジトリをインデックスキューに追加しました",
      saved: "✓ GitHub 設定を保存しました",
      tokenRequired: "まず GitHub Token を入力してください",
    },

    twitter: {
      title: "🐦 Twitter/X ブックマーク セマンティックインデックス",
      description:
        "ブラウザで Twitter/X にログインしている必要があります。拡張機能は自動的に Cookie を抽出して同期します。開発者アカウントは不要です。",
      enableSync: "Twitter ブックマーク同期を有効化",
      csrfToken: "CSRF Token (ct0) - 任意",
      csrfPlaceholder: "自動抽出失敗時に手動入力",
      csrfHint:
        "自動抽出に失敗した場合、ブラウザの開発者ツールからコピーできます",
      authToken: "Auth Token - 任意",
      authPlaceholder: "自動抽出失敗時に手動入力",
      saveSettings: "Twitter 設定を保存",
      syncBookmarks: "ブックマークを今すぐ同期",
      syncingBookmarks: "同期中...",
      syncSuccess:
        "✓ 同期成功！{{total}} 個のブックマークをインデックスに追加しました",
      saved: "✓ Twitter 設定を保存しました",
      apiKeyRequired: "まず API キーを設定してください",
    },

    history: {
      title: "📜 ブラウジング履歴 セマンティックインデックス",
      description:
        "ブラウザの閲覧履歴をセマンティック検索に含めます。http/https ページのみをインデックスし、既存のブックマーク/GitHub/Twitter 記録はスキップします。",
      enableSync: "ブラウジング履歴同期を有効化",
      syncDays: "最近 N 日間を同期",
      syncDaysHint:
        "範囲 1-365 日、デフォルト 30 日。日数が多いほど初回同期は遅くなります。",
      saveSettings: "設定を保存",
      syncNow: "履歴を今すぐ同期",
      syncingNow: "同期中...",
      syncSuccess: "✓ 同期完了！{{added}} 件追加、{{skipped}} 件スキップ",
      syncError: "同期エラー",
      saved: "✓ 履歴同期設定を保存しました",
    },

    gist: {
      title: "☁️ ブックマーク Gist 同期",
      description:
        "GitHub Gist を介して複数デバイス間でブックマークを同期します。上記で gist 権限を持つ GitHub Token を設定する必要があります。",
      createGist: "新規 Gist 作成（ローカルブックマークをアップロード）",
      linkGist: "既存の Gist ID を連携",
      gistIdPlaceholder: "Gist ID を入力（32文字の16進数）",
      gistIdHint: "他のデバイスから Gist ID を取得してここで連携",
      localBookmarks: "ローカルブックマーク: {{count}} 件",
      autoSync: "自動同期（ブックマーク変更後 5 秒で自動アップロード）",
      syncNow: "今すぐ同期",
      uploadOverwrite: "アップロードで上書き",
      downloadOverwrite: "ダウンロードで上書き",
      lastSync: "最終同期",
      confirmUploadTitle: "⬆️ アップロード上書きの確認",
      confirmUploadBody:
        "ローカルブックマークで Gist の内容を全置換します。リモートのみのブックマークは失われます。この操作は元に戻せません。",
      confirmDownloadTitle: "⬇️ ダウンロード上書きの確認",
      confirmDownloadBody:
        "Gist の内容でローカルブックマークを全置換します。ローカルのみのブックマークは削除されます。この操作は元に戻せません。",
      creating: "Gist を作成してブックマークをアップロード中...",
      createSuccess: "✓ Gist 作成成功！ID: {{gistId}}",
      linking: "Gist を検証して連携中...",
      linkSuccess:
        "✓ 連携成功！Gist ID: {{gistId}}。「今すぐ同期」をクリックして同期を開始してください。",
      syncInfo: "ブックマークを Gist に同期中...",
      syncSuccess:
        "✓ 同期完了！+{{added}} 追加, -{{removed}} 削除, {{uploaded}} 合計",
      uploadInfo: "ローカルブックマークを Gist にアップロードして上書き中...",
      uploadSuccess:
        "✓ アップロード完了！{{uploaded}} 件のブックマークを Gist に上書きしました",
      downloadInfo: "Gist をダウンロードしてローカルブックマークを上書き中...",
      downloadSuccess:
        "✓ ダウンロード完了！+{{added}} 件のブックマークを復元、{{removed}} 件のローカル項目を削除しました",
      autoSyncEnabled: "✓ 自動同期を有効化しました",
      autoSyncDisabled: "自動同期を無効化しました",
      gistIdRequired: "Gist ID を入力してください",
      tokenRequired: "GitHub Token が設定されていません",
      gistNotFound: "Gist が存在しないか、ブックマークデータが含まれていません",
      noGistLinked:
        "Gist が連携されていません。先に作成または連携してください。",
      sizeError:
        "Chrome ブックマークマネージャーで不要なブックマークを整理してから再同期するか、「アップロードで上書き」を使用して新しい Gist を作成してください。",
      inProgress: "同期は既に進行中です",
    },

    indexManager: {
      title: "⚙️ インデックスエンジン管理",
      scopeLabel: "インデックス範囲の選択",
      scopeHint:
        "フォルダを選択しない場合、デフォルトですべてのブックマークを増分インデックスします",
      cacheStatus: "🧠 ベクトルクエリキャッシュ:",
      cacheStatusHint: "（最近のクエリ結果をキャッシュして検索速度を向上）",
      apiKeyRequired: "まず API キーを設定してください",
      indexing: "インデックス構築中 {{processed}}/{{total}}",
      paused: "インデックス一時停止 ({{processed}}/{{total}})",
      completed: "✓ インデックス完了！{{count}} 個のブックマークを処理しました",
      folderSynced:
        "✓ 選択したフォルダ ({{total}} 個のブックマーク) を完全に同期しました",
      retryStarted: "✓ 再試行タスクを開始しました",
      cacheCleared: "✓ クエリキャッシュを削除しました",
      cacheClearFailed: "キャッシュ削除に失敗しました",
      clearQueryCacheCleared: "✓ クエリキャッシュを削除しました",
      databaseCleared: "✓ データベースを削除しました。すべてのインデックスデータが削除されました",
      clearQueryCacheConfirm: "クエリベクトルキャッシュを削除してもよろしいですか？これはメモリ内のクエリ埋め込みのみを削除し、インデックス済みのブックマークデータには影響しません。",
      clearDatabaseConfirm: "⚠️ 警告：ローカルデータベースを削除してもよろしいですか？\n\nこれにより、すべてのインデックス済みブックマークベクトル、要約、タグが永久に削除されます。ブラウザのブックマーク自体は削除されませんが、AI検索機能を復元するには再インデックスが必要です。\n\nこの操作は元に戻せません。",
      startFailed: "開始に失敗しました",
      pauseFailed: "一時停止に失敗しました",
      resumeFailed: "再開に失敗しました",
    },

    failedBookmarks: {
      title: "⚠️ 失敗 / 無効ブックマーク管理",
      description:
        "これらのブックマークはインデックス処理中にエラーが発生しました。URL が無効になっている可能性があります。リンクをクリックしてテストするか、直接ブックマークを削除してください。",
      noTitle: "タイトルなし",
      visit: "クリックしてアクセス",
      errorLabel: "エラー",
      deleteConfirm:
        "ブラウザからこのブックマークを完全に削除してもよろしいですか？",
      deleteFailed: "削除に失敗しました",
    },

    dataManagement: {
      description: "クエリキャッシュをクリアするか、ローカルデータベースからすべてのインデックスデータを削除します。ブラウザのブックマーク自体は削除されません。",
    },

    folderTree: {
      expand: "展開",
      collapse: "折りたたむ",
      select: "選択",
    },
  },

  search: {
    placeholder: "ブックマーク、GitHub Stars、ツイートを検索...",
    syntaxHint: "対応構文",
    githubFilter: "/github",
    twitterFilter: "/twitter",
    folderFilter: "/folder:名前",
    keyboardHint: "キーボード: ↑↓ ナビゲート、Enter 開く、Esc 閉じる",
    noResults: "「{{query}}」に関連するブックマークが見つかりませんでした",
    tryOther:
      "他のキーワードを試すか、/github /twitter でソースを絞り込んでください",
    emptyState: "キーワードを入力して検索を開始",
    searchFailed: "検索に失敗しました",
    searchError: "検索エラー",
    resultsCount: "{{count}} 件の結果",
    aiIndexed: "AI インデックス済",
  },

  background: {
    omniboxDefault:
      "🔍 Flow Search — キーワードを入力して Enter で全ページ検索を開くか、ブックマークを選択してジャンプ (/github /twitter /folder:名前)",
    searching: "🔍 セマンティック検索中...",
    cmdGithub: "🔮 /github キーワード — GitHub Stars を検索",
    cmdTwitter: "🐦 /twitter キーワード — Twitter ブックマークを検索",
    cmdHistory: "📜 /history キーワード — ブラウジング履歴を検索",
    cmdFolder: "📁 /folder:名前 キーワード — 特定フォルダ内を検索",
    folderSearch: "📁 フォルダを検索: {{name}}",
  },
} as const;
