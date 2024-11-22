import getEmbeddingModel from "@/helpers/utils/getEmbeddingModel";
import { PluginSettings } from "@/settings/settings";
import { openAndHighlightText } from "@/utils/editor-helpers";
import {
	type Index,
	Pinecone,
	type RecordMetadata,
	type ScoredPineconeRecord,
} from "@pinecone-database/pinecone";
import { type App, Notice, SuggestModal } from "obsidian";
import { LogLevel, Logger } from "../../helpers/logger";
import obsidianFetchApi from "../../helpers/utils/obsidianFetchApi";

export class SearchNotesModal extends SuggestModal<
	ScoredPineconeRecord<RecordMetadata>
> {
	private logger: Logger;
	private debouncedGetSuggestions: (
		query: string,
	) => Promise<ScoredPineconeRecord<RecordMetadata>[]>;
	private pineconeIndex: Index<RecordMetadata>;
	private isSearching = false;
	private currentSearchController: AbortController | null = null;
	private previousQuery = "";
	private previousResults: ScoredPineconeRecord<RecordMetadata>[] = [];

	constructor(
		app: App,
		private settings: PluginSettings,
	) {
		super(app);
		this.logger = new Logger("SearchNotesModal", LogLevel.DEBUG);

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

	private async searchNotes(query: string, topK = 10) {
		try {
			if (this.currentSearchController) {
				this.currentSearchController.abort();
			}

			this.currentSearchController = new AbortController();

			this.logger.debug("검색 시작:", query);
			const vector = await this.getQueryVector(query);

			const results = await this.pineconeIndex.query({
				vector,
				includeMetadata: true,
				topK,
			});

			this.logger.debug("검색 결과:", results);
			return results.matches || [];
		} catch (error) {
			this.logger.error("검색 중 오류 발생:", error);
			new Notice("검색 중 오류가 발생했습니다.");
			return [];
		} finally {
			this.currentSearchController = null;
		}
	}

	async getSuggestions(
		query: string,
	): Promise<ScoredPineconeRecord<RecordMetadata>[]> {
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

	renderSuggestion(
		item: ScoredPineconeRecord<RecordMetadata>,
		el: HTMLElement,
	) {
		const title = item.metadata?.title?.toString() || "Untitled";
		const score = item.score !== undefined ? item.score.toFixed(2) : "N/A";
		let text = item.metadata?.text?.toString() || "";

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
			text: `(Score: ${score})`,
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

	async onChooseSuggestion(item: ScoredPineconeRecord<RecordMetadata>) {
		this.logger.debug("onChooseSuggestion", item);
		const filePath = item.metadata?.filePath?.toString() || "";
		const text = item.metadata?.text?.toString() || "";
		const fromLine = Number(item.metadata?.["loc.lines.from"] ?? 0);
		const toLine = Number(item.metadata?.["loc.lines.to"] ?? 0);

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
	private debounce<T extends (...args: unknown[]) => Promise<unknown>>(
		func: T,
		wait: number,
	): (...args: Parameters<T>) => ReturnType<T> {
		let timeout: NodeJS.Timeout;

		return (...args: Parameters<T>): ReturnType<T> => {
			return new Promise((resolve) => {
				clearTimeout(timeout);
				timeout = setTimeout(async () => {
					const result = await func.apply(this, args);
					resolve(result);
				}, wait);
			}) as ReturnType<T>;
		};
	}
}
