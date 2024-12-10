import { AppContext, SettingsContext } from "@/helpers/context";
import { useApp, useSettings } from "@/helpers/hooks";
import { Logger } from "@/helpers/logger";
import getEmbeddingModel from "@/helpers/utils/getEmbeddingModel";
import { createPineconeClient } from "@/services/PineconeManager";
import { PluginSettings } from "@/settings/settings";
import { useQuery } from "@tanstack/react-query";
import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { StrictMode, useCallback, useMemo, useState } from "react";
import { Root, createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { openAndHighlightText } from "../../utils/editor-helpers";
import SearchResultItem from "../RelatedNotesView/components/SearchResultItem";
import { PLUGIN_APP_ID } from "../../constants";

export const VIEW_TYPE_SEARCH = `${PLUGIN_APP_ID}-search-view`;

interface SearchViewProps {
  onClose?: () => void;
}

const SearchView = ({ onClose }: SearchViewProps) => {
  const app = useApp();
  const settings = useSettings();
  const [searchQuery, setSearchQuery] = useState("");
  const logger = useMemo(
    () => new Logger("SearchView", settings?.logLevel),
    [settings?.logLevel],
  );

  const queryByContent = async (query: string) => {
    if (!settings?.pineconeApiKey || !settings?.pineconeIndexName) {
      throw new Error("Pinecone API key or index name is not set");
    }

    const pc = createPineconeClient(settings.pineconeApiKey);
    const index = pc.Index(settings.pineconeIndexName);
    const embeddings = await getEmbeddingModel(settings);
    const vector = await embeddings.embedQuery(query);
    const queryResponse = await index.query({
      vector,
      topK: 100,
      includeMetadata: true,
    });
    return queryResponse.matches;
  };

  const {
    data: matches = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["search-notes", searchQuery],
    queryFn: async () => {
      if (!searchQuery) return [];
      return queryByContent(searchQuery);
    },
    enabled:
      !!searchQuery &&
      !!settings?.pineconeApiKey &&
      !!settings?.pineconeIndexName,
  });

  const handleTitleClick = async (filePath: string) => {
    if (!filePath) {
      new Notice("File path not found");
      return;
    }

    try {
      const targetFile = app?.vault.getAbstractFileByPath(filePath);
      if (!(targetFile instanceof TFile)) {
        new Notice(`File not found: ${filePath}`);
        return;
      }

      await app?.workspace.getLeaf().openFile(targetFile);
    } catch (error) {
      console.error("Error opening file:", error);
      new Notice("Failed to open file");
    }
  };

  const handleMatchClick = async (
    filePath: string,
    text: string,
    fromLine: number,
    toLine: number,
  ) => {
    if (!app) return;

    try {
      await openAndHighlightText(app, filePath, text, {
        from: fromLine,
        to: toLine,
      });
    } catch (error) {
      console.error("Error opening file:", error);
      new Notice(error.message);
    }
  };

  const handleSearch = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <div className="search-view">
      <div className="search-input-container">
        <input
          type="text"
          placeholder="Search notes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSearch();
            }
          }}
        />
        <button onClick={handleSearch}>Search</button>
      </div>

      <div className="search-result-container">
        <div className="search-results-children">
          {matches.map((match) => {
            const title = String(match.metadata?.title || "Untitled");
            const subtext = String(match.metadata?.text || "")?.replace(
              /^(?:\(cont'd\)\s*)?/,
              "",
            );
            const score =
              match.score !== undefined ? match.score.toFixed(2) : "0.00";
            const filePath = match.metadata?.filePath?.toString();
            const from = Number(match.metadata?.["loc.lines.from"]);
            const to = Number(match.metadata?.["loc.lines.to"]);

            return (
              <SearchResultItem
                key={match.id}
                id={match.id}
                filePath={filePath}
                title={title}
                text={subtext}
                score={score}
                from={from}
                to={to}
                onTitleClick={handleTitleClick}
                onMatchClick={handleMatchClick}
              />
            );
          })}
        </div>
        {!isLoading && matches.length === 0 && searchQuery && (
          <div className="search-empty-state">No results found.</div>
        )}
      </div>
    </div>
  );
};

export class SearchViewContainer extends ItemView {
  private root: Root | null = null;
  private queryClient: QueryClient;

  constructor(leaf: WorkspaceLeaf, private settings: PluginSettings) {
    super(leaf);
    this.queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnWindowFocus: false,
        },
      },
    });
  }

  getViewType(): string {
    return VIEW_TYPE_SEARCH;
  }

  getDisplayText(): string {
    return "Search Notes";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    this.root = createRoot(container);
    this.renderComponent();
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
  }

  private renderComponent() {
    this.root?.render(
      <StrictMode>
        <QueryClientProvider client={this.queryClient}>
          <AppContext.Provider value={this.app}>
            <SettingsContext.Provider value={this.settings}>
              <SearchView onClose={() => this.onClose()} />
            </SettingsContext.Provider>
          </AppContext.Provider>
        </QueryClientProvider>
      </StrictMode>,
    );
  }
}
