import getEmbeddingModel from "@/helpers/utils/getEmbeddingModel";
import { PluginSettings } from "@/settings/settings";
import { openAndHighlightText } from "@/utils/editor-helpers";
import {
	type Index,
	Pinecone,
	type RecordMetadata,
} from "@pinecone-database/pinecone";
import { type App, Notice, SuggestModal } from "obsidian";
import { Logger } from "../../helpers/logger";
import obsidianFetchApi from "../../helpers/utils/obsidianFetchApi";

type SearchResult = {
	title: string;
	score: number;
	text: string;
	filePath: string;
	fromLine: number;
	toLine: number;
	source: "pinecone" | "omniSearch";
};

export class SearchNotesModal extends SuggestModal<SearchResult> {
	private logger: Logger;
	private debouncedGetSuggestions: (query: string) => Promise<SearchResult[]>;
	private pineconeIndex: Index<RecordMetadata>;
	private isSearching = false;
	private currentSearchController: AbortController | null = null;
	private previousQuery = "";
	private previousResults: SearchResult[] = [];

	constructor(
		app: App,
		private settings: PluginSettings,
	) {
		super(app);
		this.logger = new Logger("SearchNotesModal", settings.logLevel);

		// Pinecone 클라이언트 초기화 with custom fetch
		const customFetch = (input: RequestInfo | URL, init?: RequestInit) => {
			if (this.currentSearchController) {
				return obsidianFetchApi(input, {
					...init,
					signal: this.currentSearchController.signal,
				});
			}
			return obsidianFetchApi(input, init);
		};

		const pinecone = new Pinecone({
			apiKey: this.settings.pineconeApiKey,
			fetchApi: customFetch,
		});
		this.pineconeIndex = pinecone.Index(this.settings.pineconeIndexName);

		// debounce 함수 생성 (300ms 딜레이)
		this.debouncedGetSuggestions = this.debounce(
			(query: string) => this.searchNotes(query),
			300,
		);
	}

	onClose(): void {
		// 1. 진행 중인 작업 정리
		if (this.debouncedGetSuggestions) {
			clearTimeout(this.debouncedGetSuggestions as never);
		}
	}

	private async searchNotes(query: string, topK = 10): Promise<SearchResult[]> {
		try {
			if (this.currentSearchController) {
				this.currentSearchController.abort();
			}

			this.currentSearchController = new AbortController();

			this.logger.debug("벡터 데이터베이스 검색 시작:", query);
			const vector = await this.getQueryVector(query);

			const pioneconeResults = await this.pineconeIndex.query({
				vector,
				includeMetadata: true,
				topK,
			});
			this.logger.debug("벡터 데이터베이스 검색 결과:", pioneconeResults);
			const results: SearchResult[] =
				pioneconeResults.matches?.map((item) => {
					const score = item.score ?? 0;
					const title = item.metadata?.title?.toString() ?? "Untitled";
					const filePath = item.metadata?.filePath?.toString() || "";
					const fromLine = Number(item.metadata?.["loc.lines.from"] ?? 0);
					const toLine = Number(item.metadata?.["loc.lines.to"] ?? 0);
					let text = item.metadata?.text?.toString() || "";

					// "(cont'd)" 로 시작하는 경우 제거
					if (text?.startsWith("(cont'd)")) {
						text = text.substring("(cont'd)".length).trim();
					}

					return {
						title,
						score,
						text,
						filePath,
						fromLine,
						toLine,
						source: "pinecone",
					};
				}) || [];

			const omniSearchResults = await window.omnisearch?.search?.(query);
			this.logger.debug("omniSearchResults", omniSearchResults);

			omniSearchResults?.forEach((result) => {
				const score = result.score;
				const title = result.basename;
				const filePath = result.path;
				const fromLine = result.matches?.[0].offset;
				const toLine = result.matches?.[result.matches.length - 1].offset;
				const text = result.excerpt;

				results.push({
					title,
					score,
					text,
					filePath,
					fromLine,
					toLine,
					source: "omniSearch",
				});
			});

			return results?.sort((a, b) => b.score - a.score);
		} catch (error) {
			this.logger.error("검색 중 오류 발생:", error);
			new Notice("검색 중 오류가 발생했습니다.");
			return [];
		} finally {
			this.currentSearchController = null;
		}
	}

	async getSuggestions(query: string): Promise<SearchResult[]> {
		const trimmedQuery = query.trim();

		// 쿼리가 비어있거나 2글자 미만인 경우 빈 배열 반환
		if (!trimmedQuery || trimmedQuery.length < 2) {
			return [];
		}

		// 이전 검색어와 동일한 경우 이전 결과를 반환
		if (trimmedQuery === this.previousQuery) {
			return this.previousResults;
		}

		this.isSearching = true;
		this.previousQuery = trimmedQuery;
		const results = await this.debouncedGetSuggestions(trimmedQuery);
		this.previousResults = results; // 검색 결과를 캐시에 저장
		this.isSearching = false;
		return results;
	}

	private async getQueryVector(query: string): Promise<number[]> {
		const embeddings = await getEmbeddingModel(this.settings);
		return await embeddings.embedQuery(query);
	}

	/**
	 * Compute softmax values for each sets of scores in x.
	 * @param x number array of scores
	 * @returns array of probabilities
	 */
	private softmax(x: number[]): number[] {
		const maxVal = Math.max(...x);
		const expValues = x.map((value) => Math.exp(value - maxVal));
		const sumExp = expValues.reduce((acc, val) => acc + val, 0);
		return expValues.map((value) => value / sumExp);
	}

	renderSuggestion(item: SearchResult, el: HTMLElement) {
		const title = item.title || "Untitled";
		const score = item.score !== undefined ? item.score.toFixed(2) : "N/A";
		let text = item.text || "";

		// "(cont'd)" 로 시작하는 경우 제거
		if (text.startsWith("(cont'd)")) {
			text = text.substring("(cont'd)".length).trim();
		}

		// 컨테이너 생성
		const container = el.createDiv({ cls: "search-notes-modal__item" });

		// 제목과 점수를 포함하는 상단 행
		const headerEl = container.createDiv({
			cls: "search-notes-modal__header",
		});
		headerEl.createEl("span", {
			text: title,
			cls: "search-notes-modal__title",
		});
		headerEl.createEl("span", {
			text: item.source === "pinecone" ? "Pinecone" : "OmniSearch",
			cls: `search-notes-modal__source-badge ${item.source}`,
		});
		headerEl.createEl("span", {
			text: score,
			cls: "search-notes-modal__score",
		});

		// 내용 미리보기 (최대 100자)
		if (text) {
			container.createDiv({
				text,
				cls: "search-notes-modal__preview",
			});
		}
	}

	async onChooseSuggestion(item: SearchResult) {
		this.logger.debug("onChooseSuggestion", item);
		const filePath = item.filePath || "";
		const text = item.text || "";
		const fromLine = Number(item.fromLine ?? 0);
		const toLine = Number(item.toLine ?? 0);

		try {
			await openAndHighlightText(this.app, filePath, text, {
				from: fromLine,
				to: toLine,
			});
		} catch (error) {
			console.error("Error opening file:", error);
			new Notice(error.message);
		}
	}

	// debounce 유틸리티 함수
	private debounce<
		T extends (...args: any[]) => Promise<any>,
		R = Awaited<ReturnType<T>>,
	>(func: T, wait: number): (...args: Parameters<T>) => Promise<R> {
		let timeout: NodeJS.Timeout;

		return (...args: Parameters<T>): Promise<R> => {
			return new Promise((resolve) => {
				clearTimeout(timeout);
				timeout = setTimeout(async () => {
					const result = await func.apply(this, args);
					resolve(result);
				}, wait);
			});
		};
	}
}
