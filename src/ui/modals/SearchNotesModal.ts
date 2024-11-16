import {
	type Index,
	Pinecone,
	type PineconeConfiguration,
	type RecordMetadata,
	type ScoredPineconeRecord,
} from "@pinecone-database/pinecone";
import {
	type App,
	type MarkdownView,
	Notice,
	SuggestModal,
	TFile,
} from "obsidian";
import type OpenAI from "openai";
import { DEFAULT_EMBEDDING_MODEL } from "../../constants";
import { LogLevel, Logger } from "../../helpers/logger";
import obsidianFetchApi from "../../helpers/utils/obsidianFetchApi";
import { createOpenAIClient } from "../../services/OpenAIManager";
import { createPineconeClient } from "../../services/PineconeManager";

interface Location {
	lines: {
		from: number;
		to?: number;
	};
}

export class SearchNotesModal extends SuggestModal<
	ScoredPineconeRecord<RecordMetadata>
> {
	private logger: Logger;
	private debouncedGetSuggestions: (
		query: string,
	) => Promise<ScoredPineconeRecord<RecordMetadata>[]>;
	private openai: OpenAI;
	private pineconeIndex: Index<RecordMetadata>;
	private isSearching = false;
	private currentSearchController: AbortController | null = null;
	private previousQuery = "";

	constructor(
		app: App,
		private openAIApiKey: string,
		private pineconeApiKey: string,
		private selectedIndex: string,
	) {
		super(app);
		this.logger = new Logger("SearchNotesModal", LogLevel.DEBUG);

		this.logger.debug("모달 초기화", {
			selectedIndex: this.selectedIndex,
		});

		this.openai = createOpenAIClient(this.openAIApiKey);
		const pinecone = createPineconeClient(this.pineconeApiKey);
		this.pineconeIndex = pinecone.Index(this.selectedIndex);

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

	private initializePineconeClient() {
		const customFetch = (input: RequestInfo | URL, init?: RequestInit) => {
			if (this.currentSearchController) {
				const modifiedInit = {
					...init,
					signal: this.currentSearchController.signal,
				};
				return obsidianFetchApi(input, modifiedInit);
			}
			return obsidianFetchApi(input, init);
		};

		const config: PineconeConfiguration = {
			apiKey: this.pineconeApiKey,
			fetchApi: customFetch,
		};

		const pinecone = new Pinecone(config);
		this.pineconeIndex = pinecone.Index(this.selectedIndex);
	}

	/**
	 * 주어진 쿼리로 노트를 검색합니다.
	 * @param query - 검색할 텍스트
	 * @param topK - 반환할 최대 결과 수 (기본값: 10)
	 * @returns 검색된 노트 목록과 유사도 점수
	 */
	private async searchNotes(query: string, topK = 10) {
		try {
			// 이전 검색 요청이 있다면 취소
			if (this.currentSearchController) {
				this.currentSearchController.abort();
			}

			// 새로운 AbortController 생성
			this.currentSearchController = new AbortController();

			this.logger.debug("검색 시작:", query);
			const vector = await this.getQueryVector(query);

			const results = await this.pineconeIndex.query({
				vector,
				includeMetadata: true,
				topK,
			});

			this.logger.debug("검색 결과:", results);
			return results.matches;
		} catch (error) {
			console.error("Search error:", error);
			new Notice("Failed to search notes");
			return [];
		} finally {
			// 검색이 완료되면 현재 controller 초기화
			this.currentSearchController = null;
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

	async getSuggestions(
		query: string,
	): Promise<ScoredPineconeRecord<RecordMetadata>[]> {
		const trimmedQuery = query.trim();

		// 쿼리가 비어있거나 2글자 미만인 경우 빈 배열 반환
		if (!trimmedQuery || trimmedQuery.length < 2) {
			return [];
		}

		// 이전 검색어와 동일한 경우 검색하지 않음
		if (trimmedQuery === this.previousQuery) {
			return [];
		}

		this.isSearching = true;
		this.previousQuery = trimmedQuery;
		const results = await this.debouncedGetSuggestions(trimmedQuery);
		this.isSearching = false;
		return results;
	}

	private async getQueryVector(query: string): Promise<number[]> {
		const response = await this.openai.embeddings.create({
			input: query,
			model: DEFAULT_EMBEDDING_MODEL,
		});
		return response.data[0].embedding;
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
		const filePath = item.metadata?.filePath;
		const lineNumber = (item.metadata?.loc as Location)?.lines?.from ?? 0;

		if (filePath) {
			const file = this.app.vault.getAbstractFileByPath(filePath.toString());

			if (file instanceof TFile) {
				// 파일을 열고 특정 라인으로 이동
				const leaf = this.app.workspace.getLeaf();
				await leaf.openFile(file);

				// 에디터가 준비되면 해당 라인으로 스크롤
				if (lineNumber !== undefined) {
					const view = leaf.view;
					if (view.getViewType() === "markdown") {
						const editor = (view as MarkdownView).editor;
						if (editor) {
							// 해당 라인으로 스크롤
							editor.setCursor(lineNumber - 1);
							// 에디터 뷰 중앙으로 스크롤
							editor.scrollIntoView(
								{
									from: { line: lineNumber - 1, ch: 0 },
									to: { line: lineNumber - 1, ch: 0 },
								},
								true,
							);
						}
					}
				}
			}
		}
	}
}
