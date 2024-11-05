import {
	Index,
	Pinecone,
	RecordMetadata,
	ScoredPineconeRecord,
} from "@pinecone-database/pinecone";
import { App, Notice, SuggestModal, TFile } from "obsidian";
import OpenAI from "openai";
import { DEFAULT_EMBEDDING_MODEL } from "src/constants";
import { createOpenAIClient } from "src/services/OpenAIManager";
import { createPineconeClient } from "src/services/PineconeManager";
import { Logger, LogLevel } from "src/helpers/logger";

export class SearchNotesModal extends SuggestModal<
	ScoredPineconeRecord<RecordMetadata>
> {
	private logger: Logger;
	private debouncedGetSuggestions: (
		query: string
	) => Promise<ScoredPineconeRecord<RecordMetadata>[]>;
	private openai: OpenAI;
	private pc: Pinecone;
	private index: Index<RecordMetadata>;

	constructor(
		app: App,
		private openAIApiKey: string,
		private pineconeApiKey: string,
		private selectedIndex: string
	) {
		super(app);
		this.logger = new Logger("SearchNotesModal", LogLevel.DEBUG);

		this.logger.debug("모달 초기화", {
			selectedIndex: this.selectedIndex,
		});

		this.openai = createOpenAIClient(this.openAIApiKey);
		this.pc = createPineconeClient(this.pineconeApiKey);
		this.index = this.pc.index(this.selectedIndex);

		// debounce 함수 생성 (300ms 딜레이)
		this.debouncedGetSuggestions = this.debounce(
			(query: string) => this.searchNotes(query),
			300
		);
	}


	onClose(): void {
		// 1. 진행 중인 작업 정리
		if (this.debouncedGetSuggestions) {
			clearTimeout(this.debouncedGetSuggestions as never);
		}
	}

	// 실제 검색 로직을 별도의 메서드로 분리
	private async searchNotes(
		query: string
	): Promise<ScoredPineconeRecord<RecordMetadata>[]> {
		try {
			const results = await this.index.query({
				vector: await this.getQueryVector(query),
				topK: 10,
				includeMetadata: true,
			});
			this.logger.debug("검색 결과:", results);
			return results.matches;
		} catch (error) {
			console.error("Search error:", error);
			new Notice("Failed to search notes");
			return [];
		}
	}

	// debounce 유틸리티 함수
	private debounce<T extends (...args: unknown[]) => Promise<unknown>>(
		func: T,
		wait: number
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
		query: string
	): Promise<ScoredPineconeRecord<RecordMetadata>[]> {
		const trimmedQuery = query.trim();

		// 쿼리가 비어있거나 2글자 미만인 경우 빈 배열 반환
		if (!trimmedQuery || trimmedQuery.length < 2) {
			this.logger.debug("검색어가 너무 짧음", {
				query: trimmedQuery,
				length: trimmedQuery.length,
			});
			return [];
		}

		return this.debouncedGetSuggestions(query);
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
		el: HTMLElement
	) {
		const title = item.metadata?.title?.toString() || "Untitled";
		const score = item.score !== undefined ? item.score.toFixed(2) : "N/A";

		el.createEl("div", { text: title });
		const scoreEl = el.createEl("span", { text: ` (Score: ${score})` });

		// 스타일 적용
		scoreEl.className = "search-notes-modal__score";
	}

	onChooseSuggestion(item: ScoredPineconeRecord<RecordMetadata>) {
		const filePath = item.metadata?.filePath;
		if (filePath) {
			const file = this.app.vault.getAbstractFileByPath(
				filePath.toString()
			);
			if (file instanceof TFile) {
				this.app.workspace.getLeaf().openFile(file);
			}
		}
	}
}
