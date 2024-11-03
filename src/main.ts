import {
	Index,
	Pinecone,
	RecordMetadata,
	ScoredPineconeRecord,
} from "@pinecone-database/pinecone";
import {
	App,
	Notice,
	parseYaml,
	Plugin,
	SuggestModal,
	TAbstractFile,
	TFile,
} from "obsidian";
import OpenAI from "openai";
import { DEFAULT_EMBEDDING_MODEL, PLUGIN_APP_ID } from "./contants";
import { SettingTab } from "./settings/settingTab";
import { DEFAULT_SETTINGS, PluginSettings } from "./settings/settings";
import { NoteMetadata } from "./types";
import { getFileNameSafe } from "./utils/fileUtils";
import { createHash } from "./utils/hash";
import { Logger, LogLevel } from "./utils/logger";
import { createOpenAIClient } from "./utils/openai";
import { createPineconeClient } from "./utils/pinecone";



export default class SmartSeekerPlugin extends Plugin {
	settings: PluginSettings;

	private logger = new Logger("SmartSeekerPlugin", LogLevel.INFO);

	private registerVaultEvents(): void {
		// 노트 생성, 업데이트, 삭제 이벤트 감지
		this.registerEvent(
			this.app.vault.on(
				"create",
				this.handleNoteCreateOrUpdate.bind(this)
			)
		);
		this.registerEvent(
			this.app.vault.on(
				"modify",
				this.handleNoteCreateOrUpdate.bind(this)
			)
		);
		this.registerEvent(
			this.app.vault.on("delete", this.handleNoteDelete.bind(this))
		);
	}

	async onload() {
		await this.loadSettings();

		// 설정 탭 추가
		this.addSettingTab(new SettingTab(this.app, this));

		// 워크스페이스가 준비된 후에 이벤트 리스너 등록
		this.app.workspace.onLayoutReady(() => {
			this.registerVaultEvents();
		});

		// 명령어 추가
		this.addCommand({
			id: "search-notes",
			name: "Search notes",
			callback: () => {
				if (
					!this.settings.pineconeApiKey ||
					!this.settings.selectedIndex
				) {
					new Notice("Please configure PineconeDB settings first");
					return;
				}
				new SearchNotesModal(
					this.app,
					this.settings.openAIApiKey,
					this.settings.pineconeApiKey,
					this.settings.selectedIndex
				).open();
			},
		});
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async extractMetadata(file: TFile, content: string) {
		const metadata: NoteMetadata = {
			filePath: file.path,
			ctime: file.stat.ctime,
			mtime: file.stat.mtime,
			title: getFileNameSafe(file.path),
		};

		const frontMatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
		if (frontMatterMatch) {
			return { ...metadata, ...parseYaml(frontMatterMatch[1]) };
		}

		return metadata;
	}

	private async createEmbeddings(content: string) {
		const openai = createOpenAIClient(this.settings.openAIApiKey);
		const response = await openai.embeddings.create({
			input: content,
			model: DEFAULT_EMBEDDING_MODEL,
		});
		return response.data[0].embedding;
	}

	private async saveToPinecone(
		hash: string,
		embeddings: number[],
		metadata?: RecordMetadata | undefined
	) {
		const pc = createPineconeClient(this.settings.pineconeApiKey);
		const index = pc.index(this.settings.selectedIndex);
		await index.upsert([
			{
				id: hash,
				values: embeddings,
				metadata: metadata,
			},
		]);
	}

	async handleNoteCreateOrUpdate(file: TAbstractFile): Promise<void> {
		try {
			if (!(file instanceof TFile) || file.extension !== "md") {
				return;
			}

			if (!this.app.workspace.layoutReady) {
				return;
			}

			// 노트 생성 또는 업데이트 시 파인콘DB에 저장
			console.log(`Note created or updated: ${file.path}`);

			const noteContent = await this.app.vault.read(file);

			// 노트의 토큰 수 계산
			const tokenCount = noteContent.split(/\s+/).length;
			if (tokenCount < 200) {
				console.log(
					`Note skipped due to insufficient tokens: ${tokenCount}`
				);
				return;
			}
			// 플러그인 폴더 경로 가져오기
			const pluginDir = `${this.app.vault.configDir}/plugins/${PLUGIN_APP_ID}`;
			const cacheFilePath = `${pluginDir}/cache.json`;
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(pluginDir))) adapter.mkdir(pluginDir);
			const cachedData = (await adapter.exists(cacheFilePath))
				? JSON.parse(await adapter.read(cacheFilePath))
				: {};
			const cacheKey = await createHash(file.path + noteContent);

			// 이전 해시와 비교하여 변경된 경우에만 임베딩 생성
			if (cachedData[cacheKey]) {
				console.log(`Note skipped due to no changes: ${file.path}`);
				return;
			}

			const hash = await createHash(file.path);
			const metadata = await this.extractMetadata(file, noteContent);

			const embeddings = await this.createEmbeddings(noteContent);
			await this.saveToPinecone(hash, embeddings, metadata);

			// 해시 업데이트
			try {
				await adapter.write(
					cacheFilePath,
					JSON.stringify({ ...cachedData, [cacheKey]: embeddings })
				);

				console.log("JSON 파일이 성공적으로 생성되었습니다.");
			} catch (error) {
				console.error("JSON 파일 생성 중 오류 발생:", error);
			}

			// this.settings.previousHashes[file.path] = hash;
			await this.saveSettings();

			new Notice("Note successfully saved to PineconeDB");
		} catch (error) {
			console.error("노트 처리 중 오류 발생:", error);
			new Notice("Failed to save note to PineconeDB");
		}
	}

	async handleNoteDelete(file: TAbstractFile): Promise<void> {
		try {
			if (!(file instanceof TFile) || file.extension !== "md") {
				return;
			}

			if (!this.app.workspace.layoutReady) {
				return;
			}

			// 노트 삭제 시 파인콘DB에서 삭제
			console.log(`Note deleted: ${file.path}`);

			// 파일 경로로부터 해시 생성
			const hash = await createHash(file.path);
			const pc = createPineconeClient(this.settings.pineconeApiKey);
			const index = pc.index(this.settings.selectedIndex);
			await index.deleteMany([hash]);

			new Notice("Note successfully deleted from PineconeDB");
		} catch (error) {
			console.error(`Failed to delete note ${file.path}:`, error);
			new Notice("Failed to delete note from PineconeDB");
		}
	}
}

class SearchNotesModal extends SuggestModal<
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
