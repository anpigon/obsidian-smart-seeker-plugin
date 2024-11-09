import { Document } from "@langchain/core/documents";
import { PineconeStore } from "@langchain/pinecone";
import { TokenTextSplitter } from "@langchain/textsplitters";
import { Index as PineconeIndex } from "@pinecone-database/pinecone";
import { Notice, parseYaml, Plugin, TAbstractFile, TFile } from "obsidian";
import {
	DEFAULT_CHUNK_OVERLAP,
	DEFAULT_CHUNK_SIZE,
	DEFAULT_MIN_TOKEN_COUNT,
	PLUGIN_APP_ID,
} from "./constants";
import { InLocalStore } from "./helpers/langchain/store";
import { Logger, LogLevel } from "./helpers/logger";
import calculateTokenCount from "./helpers/utils/calculateTokenCount";
import { getFileNameSafe } from "./helpers/utils/fileUtils";
import getEmbeddingModel from "./helpers/utils/getEmbeddingModel";
import { createHash } from "./helpers/utils/hash";
import { removeAllWhitespace } from "./helpers/utils/stringUtils";
import { createPineconeClient } from "./services/PineconeManager";
import { SettingTab } from "./settings/settingTab";
import { DEFAULT_SETTINGS, PluginSettings } from "./settings/settings";
import { NoteMetadata } from "./types";
import { SearchNotesModal } from "./ui/modals/SearchNotesModal";

export default class SmartSeekerPlugin extends Plugin {
	private logger = new Logger("SmartSeekerPlugin", LogLevel.INFO);
	private localStore: InLocalStore;
	private notesToSave: Record<string, string> = {};
	private isProcessing = false;
	settings: PluginSettings;

	private registerVaultEvents(): void {
		if (!this.app.workspace.layoutReady) {
			this.logger.warn(
				"Workspace not ready, skipping event registration"
			);
			return;
		}

		// 노트 생성, 업데이트, 삭제 이벤트 감지
		this.registerEvent(
			this.app.vault.on("create", (file) =>
				this.handleNoteCreateOrUpdate(file)
			)
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) =>
				this.handleNoteCreateOrUpdate(file)
			)
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => this.handleNoteDelete(file))
		);

		// 주기적인 임베딩 처리
		this.registerInterval(
			window.setInterval(() => {
				if (this.app.workspace.layoutReady) {
					this.embeddingNotes();
				}
			}, 10 * 1000)
		);
	}

	private async initializeLocalStore() {
		if (!this.localStore) {
			// InLocalStore 초기화
			this.localStore = new InLocalStore(this.app.vault, PLUGIN_APP_ID);
		}
	}

	private validateApiKeys(): boolean {
		const isValid = !!(
			this.settings.pineconeApiKey?.trim() &&
			this.settings.openAIApiKey?.trim() &&
			this.settings.selectedIndex?.trim()
		);

		if (!isValid) {
			this.logger.warn("API configuration is missing or invalid");
		}

		return isValid;
	}

	private async initializePlugin() {
		await this.initializeLocalStore();
		this.registerVaultEvents();
	}

	private addCommands() {
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

	async onload() {
		await this.loadSettings();

		// 설정 탭 추가
		this.addSettingTab(new SettingTab(this.app, this));

		// 워크스페이스가 준비된 후에 이벤트 리스너 등록
		this.app.workspace.onLayoutReady(async () => {
			await this.initializePlugin();
		});

		// 명령어 추가
		this.addCommands();
	}

	async onunload() {
		try {
			// 남은 데이터 처리
			if (Object.keys(this.notesToSave).length > 0) {
				await this.embeddingNotes();
			}

			// 설정 저장
			await this.saveData(this.settings);
		} catch (error) {
			this.logger?.error("Failed to cleanup on unload:", error);
		}

		// 로깅
		this.logger?.debug("Plugin unloaded");
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

	private async extractMetadata(
		file: TFile,
		content: string
	): Promise<NoteMetadata> {
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

	private async splitContent(documents: Document[]): Promise<Document[]> {
		const textSplitter = new TokenTextSplitter({
			chunkSize: DEFAULT_CHUNK_SIZE,
			chunkOverlap: DEFAULT_CHUNK_OVERLAP,
		});
		return await textSplitter.splitDocuments(documents, {
			appendChunkOverlapHeader: true,
		});
	}

	private async saveToPinecone(
		documents: Array<Document>,
		ids: Array<string>
	) {
		const pinecone = createPineconeClient(this.settings.pineconeApiKey);
		const pineconeIndex: PineconeIndex = pinecone.Index(
			this.settings.selectedIndex
		);
		const embedding = getEmbeddingModel(this.settings);
		const vectorStore = await PineconeStore.fromExistingIndex(embedding, {
			pineconeIndex,
			maxConcurrency: 5,
		});
		await vectorStore.addDocuments(documents, { ids });
	}

	private validateNote(file: TAbstractFile): file is TFile {
		if (!this.app.workspace.layoutReady) {
			this.logger.debug("Workspace not ready, skipping note validation");
			return false;
		}

		if (!(file instanceof TFile)) {
			this.logger.debug("Not a file:", file);
			return false;
		}

		if (file.extension !== "md") {
			this.logger.debug("Not a markdown file:", file.path);
			return false;
		}

		return true;
	}

	// 토큰 수 검증 함수
	private validateTokenCount(
		text: string,
		minTokenCount: number = DEFAULT_MIN_TOKEN_COUNT
	): boolean {
		try {
			const tokenCount = calculateTokenCount(text);
			this.logger.debug("Token count:", tokenCount);

			if (tokenCount < minTokenCount) {
				this.logger.info(
					`Note skipped due to insufficient tokens (${tokenCount}/${minTokenCount})`
				);
				return false;
			}
			return true;
		} catch (error) {
			this.logger.error("Error calculating token count:", error);
			return false;
		}
	}

	async handleNoteCreateOrUpdate(file: TAbstractFile): Promise<void> {
		try {
			if (!this.validateNote(file)) return;
			if (!this.validateApiKeys()) return;

			this.logger.info(`Processing note: ${file.path}`);
			const pageContent = await this.app.vault.cachedRead(file);

			if (!this.validateTokenCount(pageContent)) return;

			this.notesToSave[file.path] = pageContent;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			this.logger.error(
				`Failed to process note ${file.path}: ${errorMessage}`
			);
			new Notice(`Failed to process note: ${errorMessage}`);
		}
	}

	async prepareDocuments(notesToProcess: Record<string, string>) {
		const documents: Document[] = [];
		for (const filePath in notesToProcess) {
			const file = this.app.vault.getFileByPath(filePath);
			if (file) {
				const pageContent = notesToProcess[filePath];
				const metadata = await this.extractMetadata(file, pageContent);
				documents.push(new Document({ pageContent, metadata }));
			}
		}
		return documents;
	}

	async generateChunkIds(chunks: Document<Record<string, unknown>>[]) {
		const ids: string[] = [];
		for (const chunk of chunks) {
			const cleaned = removeAllWhitespace(chunk.pageContent);
			const id = await createHash(cleaned);
			ids.push(id);
		}
		return ids;
	}

	async embeddingNotes() {
		if (this.isProcessing || Object.keys(this.notesToSave).length === 0) {
			return;
		}

		this.isProcessing = true;
		const notesToProcess = { ...this.notesToSave };

		try {
			// API 키 검증
			if (!this.validateApiKeys()) {
				throw new Error("API configuration is missing or invalid");
			}

			const documents = await this.prepareDocuments(notesToProcess);

			// FIXME: 노트 청크 분할 로직 최적화 필요 - 현재 중복된 내용이 발생할 수 있음
			const chunks = await this.splitContent(documents);
			const ids = await this.generateChunkIds(chunks);

			// Pinecone에 저장
			await this.saveToPinecone(chunks, ids);
			const noteCount = Object.keys(notesToProcess).length;
			new Notice(`${noteCount} notes successfully saved to PineconeDB`);

			// 처리된 노트 제거
			Object.keys(notesToProcess).forEach(
				(key) => delete this.notesToSave[key]
			);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			const failedPaths = Object.keys(notesToProcess).join(", ");
			this.logger.error(
				`Failed to process notes (${failedPaths}): ${errorMessage}`
			);
			new Notice(`Failed to save notes: ${errorMessage}`);
		} finally {
			this.isProcessing = false;
		}
	}

	async handleNoteDelete(file: TAbstractFile): Promise<void> {
		try {
			if (!this.validateNote(file)) return;
			if (!this.validateApiKeys()) return;

			this.logger.info(`Deleting note: ${file.path}`);

			const pc = createPineconeClient(this.settings.pineconeApiKey);
			const pineconeIndex = pc.index(this.settings.selectedIndex);

			const deleteRequest = {
				filter: {
					filePath: { $eq: file.path },
				},
			};

			await pineconeIndex.deleteMany({ deleteRequest });
			new Notice(
				`Note successfully deleted from PineconeDB: ${file.path}`
			);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			this.logger.error(
				`Failed to delete note ${file.path}: ${errorMessage}`
			);
			new Notice(`Failed to delete note: ${errorMessage}`);
		}
	}
}
