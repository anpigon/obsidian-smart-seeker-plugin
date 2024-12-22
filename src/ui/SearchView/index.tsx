/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable no-mixed-spaces-and-tabs */
import { NotFoundError } from "@/errors/NotFoundError";
import { AppContext, SettingsContext } from "@/helpers/context";
import { useApp, useSettings } from "@/helpers/hooks";
import { Logger } from "@/helpers/logger";
import {
	openNote,
	openNoteAndHighlightText,
} from "@/helpers/utils/editorHelpers";
import getEmbeddingModel from "@/helpers/utils/getEmbeddingModel";
import { createPineconeClient } from "@/services/PineconeManager";
import { PLUGIN_APP_ID, ZERO_VECTOR } from "@/shared/constants";
import { PluginSettings } from "@/shared/constants/settings";
import IconCornerDownLeft from "@/widgets/icons/IconCornerDownLeft";
import SearchResultItem from "@/widgets/SearchResultItem";
import {
	QueryClient,
	QueryClientProvider,
	useMutation,
} from "@tanstack/react-query";
import { IconName, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import {
	FormEvent,
	StrictMode,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { Root, createRoot } from "react-dom/client";
import SearchSuggestion from "./components/SearchSuggestion";

export const VIEW_TYPE_SEARCH = `${PLUGIN_APP_ID}-search-view`;

interface SearchViewProps {
	onClose?: () => void;
}

const SearchView = ({ onClose }: SearchViewProps) => {
	const app = useApp()!;
	const settings = useSettings();
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<any[]>([]);
	const [showSuggestion, setShowSuggestion] = useState(false);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const searchSuggestionRef = useRef<HTMLDivElement>(null);

	const logger = useMemo(
		() => new Logger("SearchView", settings?.logLevel),
		[settings?.logLevel]
	);

	const queryByContent = async (searchQuery: string) => {
		const isTagSearch = searchQuery.startsWith("tag:");
		const isPathSearch = searchQuery.startsWith("path:");
		const isFileSearch = searchQuery.startsWith("file:");

		let query = searchQuery;
		let tag = "";
		let path = "";
		let filename = "";

		if (isTagSearch) {
			const tagMatch = searchQuery.match(/^tag:#?([^\s]+)(?:\s+(.*))?$/);
			if (tagMatch) {
				tag = tagMatch[1];
				query = tagMatch[2] || "";
			}
		} else if (isPathSearch) {
			// 쌍따옴표로 감싸진 경로를 처리하거나 공백이 없는 경로를 처리
			const pathMatch = searchQuery.match(
				/^path:(?:"([^"]+)"|([^\s]+))(?:\s+(.*))?$/
			);
			if (pathMatch) {
				path = pathMatch[1] || pathMatch[2]; // 쌍따옴표 안의 값 또는 공백이 없는 값
				query = pathMatch[3] || "";
			}
		} else if (isFileSearch) {
			// 쌍따옴표로 감싸진 파일명을 처리하거나 공백이 없는 파일명을 처리
			const fileMatch = searchQuery.match(
				/^file:(?:"([^"]+)"|([^\s]+))(?:\s+(.*))?$/
			);
			if (fileMatch) {
				filename = fileMatch[1] || fileMatch[2]; // 쌍따옴표 안의 값 또는 공백이 없는 값
				// 파일 확장자가 없으면 .md 추가
				if (!filename.includes(".")) {
					filename += ".md";
				}
				query = fileMatch[3] || "";
			}
		}

		if (!settings?.pineconeApiKey || !settings?.pineconeIndexName) {
			throw new Error("Pinecone API key or index name is not set");
		}

		const pc = createPineconeClient(settings.pineconeApiKey);
		const index = pc.Index(settings.pineconeIndexName);
		const embeddings = await getEmbeddingModel(settings);
		const vector = query ? await embeddings.embedQuery(query) : ZERO_VECTOR;

		const filter = isTagSearch
			? {
					tags: {
						$in: [tag],
					},
			  }
			: isPathSearch
			? {
					folderPaths: {
						$eq: path,
					},
			  }
			: isFileSearch
			? {
					filename: {
						$eq: filename,
					},
			  }
			: undefined;

		logger.debug("isTagSearch:", isTagSearch);
		logger.debug("isPathSearch:", isPathSearch);
		logger.debug("isFileSearch:", isFileSearch);
		logger.debug("tag:", tag);
		logger.debug("path:", path);
		logger.debug("filename:", filename);
		logger.debug("query:", query);
		logger.debug("filter:", filter);
		logger.debug("vector:", vector);

		const queryResponse = await index.query({
			vector,
			topK: 100,
			includeMetadata: true,
			filter,
		});
		logger.debug("queryResponse:", queryResponse);
		return queryResponse.matches;
	};

	const { mutate, isPending, isSuccess, isIdle } = useMutation({
		mutationFn: async (query: string) => {
			if (!query) return [];
			return queryByContent(query);
		},
		onSuccess: (data) => {
			setSearchResults(data || []);
		},
		onError: (error) => {
			logger.error("Error in queryByContent:", error);
			new Notice(error.message);
		},
	});

	const validateAndGetFile = async (
		id: string
	): Promise<{ file: TFile; match: any }> => {
		const match = searchResults.find((item) => item.id === id);
		if (!match) {
			throw new NotFoundError(`Match not found: ${id}`);
		}

		const filePath = match?.metadata?.filePath?.toString();
		if (!filePath) {
			throw new NotFoundError(`File not found: ${filePath}`);
		}

		const file = app?.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new NotFoundError(`File not found: ${filePath}`);
		}

		return { file, match };
	};

	const handleTitleClick = async (id: string) => {
		try {
			const { file, match } = await validateAndGetFile(id);
			logger.debug("--→ handleTitleClick", match);

			await openNote(app, file.path);
		} catch (error) {
			if (error instanceof NotFoundError) {
				// showConfirmDialog(id);
			} else {
				console.error("Error opening file:", error);
				new Notice("Failed to open file");
			}
		}
	};

	const handleMatchClick = async (id: string) => {
		try {
			const { file, match } = await validateAndGetFile(id);
			logger.debug("--→ handleMatchClick", match);

			const text = String(match?.metadata?.text || "");
			const from = Number(match?.metadata?.["loc.lines.from"]);
			const to = Number(match?.metadata?.["loc.lines.to"]);

			await openNoteAndHighlightText(app, file.path, text, { from, to });
		} catch (error) {
			if (error instanceof NotFoundError) {
				// showConfirmDialog(id);
			} else {
				console.error("Error opening file:", error);
				new Notice("Failed to open file");
			}
		}
	};

	const handleSearch = useCallback(
		(e: FormEvent<HTMLFormElement>) => {
			e.preventDefault();
			mutate(searchQuery);
		},
		[mutate, searchQuery]
	);

	const handleClearSearch = useCallback(() => {
		setSearchQuery("");
	}, []);

	const handleFocus = useCallback(() => {
		setShowSuggestion(true);
	}, []);

	const handleBlur = useCallback((e: React.FocusEvent) => {
		// 제안 목록 영역을 클릭한 경우 제안 목록을 숨기지 않음
		if (searchSuggestionRef.current?.contains(e.relatedTarget as Node)) {
			return;
		}
		setShowSuggestion(false);
	}, []);

	const handleSuggestionClick = useCallback((suggestion: string) => {
		setSearchQuery(suggestion);
		searchInputRef.current?.focus();
	}, []);

	return (
		<div className="search-view">
			<div className="search-input-container global-search-input-container">
				<form onSubmit={handleSearch}>
					<input
						required
						className="search-input"
						ref={searchInputRef}
						type="search"
						enterKeyHint="search"
						spellCheck={false}
						placeholder="Search notes..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onFocus={handleFocus}
						onBlur={handleBlur}
					/>
					{searchQuery && (
						<div
							className="search-input-clear-button"
							aria-label="검색어 지우기"
							onClick={handleClearSearch}
						/>
					)}
					<button
						type="submit"
						className="input-right-decorator clickable-icon"
						aria-label="엔터키로 검색 시작"
					>
						<IconCornerDownLeft />
					</button>
				</form>
			</div>

			<SearchSuggestion
				style={{
					width: 300,
					marginTop: 8,
				}}
				ref={searchSuggestionRef}
				onSuggestionClick={handleSuggestionClick}
				isOpen={showSuggestion && !searchQuery}
				onClose={() => setShowSuggestion(false)}
			/>

			<div className="search-result-container">
				{isPending && (
					<div className="tree-item-self">
						<div className="tree-item-inner related-notes-loading">
							<div className="search-status">
								<div className="search-loading">
									Searching...
								</div>
							</div>
						</div>
					</div>
				)}
				{isSuccess && searchResults.length === 0 && (
					<div className="search-empty-state">
						일치하는 결과가 없습니다.
					</div>
				)}
				{isIdle && searchResults.length === 0 && (
					<div className="search-empty-state">
						검색어를 입력하고 엔터키로 검색해주세요.
					</div>
				)}

				{isSuccess && (
					<div className="search-results-children">
						{searchResults.map((match) => {
							const title = String(
								match.metadata?.title || "Untitled"
							);
							const subtext = String(
								match.metadata?.text || ""
							)?.replace(/^(?:\(cont'd\)\s*)?/, "");
							const score =
								match.score !== undefined
									? match.score.toFixed(2)
									: "0.00";

							return (
								<SearchResultItem
									key={match.id}
									id={match.id}
									title={title}
									text={subtext}
									score={score}
									onTitleClick={handleTitleClick}
									onMatchClick={handleMatchClick}
								/>
							);
						})}
					</div>
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
		return "Semantic Search";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		this.root = createRoot(container);
		this.renderComponent();
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
	}

	getIcon(): IconName {
		return "search";
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
			</StrictMode>
		);
	}
}
