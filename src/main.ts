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
		this.registerInterval(
			window.setInterval(() => this.embeddingNotes(), 10 * 1000)
		);
	}

	private async initializeLocalStore() {
		if (!this.localStore) {
			// InLocalStore 초기화
			this.localStore = new InLocalStore(this.app.vault, PLUGIN_APP_ID);
		}
	}

	private validateApiKeys(): boolean {
		return !!(
			this.settings.pineconeApiKey?.trim() &&
			this.settings.openAIApiKey?.trim() &&
			this.settings.selectedIndex?.trim()
		);
	}

	async onload() {
		await this.loadSettings();

		// 설정 탭 추가
		this.addSettingTab(new SettingTab(this.app, this));

		// 워크스페이스가 준비된 후에 이벤트 리스너 등록
		this.app.workspace.onLayoutReady(() => {
			this.initializeLocalStore();

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

	async onunload() {
		// 설정 데이터 최종 저장
		try {
			await this.saveData(this.settings);
		} catch (error) {
			this.logger.error("Failed to save settings on unload:", error);
		}

		if (Object.keys(this.notesToSave).length > 0) {
			await this.embeddingNotes();
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
		return (
			file instanceof TFile &&
			file.extension === "md" &&
			this.app.workspace.layoutReady
		);
	}

	// 토큰 수 검증 함수
	private validateTokenCount(
		text: string,
		minTokenCount: number = DEFAULT_MIN_TOKEN_COUNT
	): boolean {
		const tokenCount = calculateTokenCount(text);
		this.logger.debug("tokenCount", tokenCount);

		// TODO: 노트의 토큰 수 계산하여 200자 미만인 경우는 제외한다.
		if (tokenCount < minTokenCount) {
			this.logger.info(
				`Note skipped due to insufficient tokens: ${tokenCount}`
			);
			return false;
		}
		return true;
	}

	async handleNoteCreateOrUpdate(file: TAbstractFile): Promise<void> {
		// 노트 생성 또는 업데이트 시 파인콘DB에 저장
		if (!this.validateNote(file)) return;
		this.logger.info(`Note created or updated: ${file.path}`);
		const pageContent = await this.app.vault.read(file);

		if (!this.validateTokenCount(pageContent)) return;

		this.notesToSave[file.path] = pageContent;
	}

	async embeddingNotes() {
		if (this.isProcessing || Object.keys(this.notesToSave).length === 0) {
			return;
		}

		this.isProcessing = true;
		const notesToProcess = { ...this.notesToSave };

		try {
			// API 키 검증
			if (
				!this.settings.pineconeApiKey ||
				!this.settings.openAIApiKey ||
				!this.settings.selectedIndex
			) {
				throw new Error("Required API keys or settings are missing");
			}

			const documents: Document[] = [];
			for (const filePath in notesToProcess) {
				const file = this.app.vault.getFileByPath(filePath);
				if (file) {
					const pageContent = notesToProcess[filePath];
					const metadata = await this.extractMetadata(
						file,
						pageContent
					);
					documents.push(new Document({ pageContent, metadata }));
				}
			}

			// FIXME: 노트 청크 분할 로직 최적화 필요 - 현재 중복된 내용이 발생할 수 있음
			const chunks = await this.splitContent(documents);

			// Pinecone에 저장
			const ids: string[] = [];
			for (const chunk of chunks) {
				const cleaned = removeAllWhitespace(chunk.pageContent);
				const id = await createHash(cleaned);
				ids.push(id);
			}

			await this.saveToPinecone(chunks, ids);
			const noteCount = Object.keys(notesToProcess).length;
			new Notice(
				`${noteCount}개의 노트가 PineconeDB에 성공적으로 저장되었습니다`
			);

			Object.keys(notesToProcess).forEach(
				(key) => delete this.notesToSave[key]
			);
		} catch (error) {
			const failedPaths = Object.keys(this.notesToSave).join(", ");
			this.logger.error(`노트 처리 실패: ${failedPaths}:`, error);
			new Notice(
				`노트 저장 실패: PineconeDB 저장 중 오류가 발생했습니다`
			);
		} finally {
			this.isProcessing = false;
		}
	}

	async handleNoteDelete(file: TAbstractFile): Promise<void> {
		try {
			if (!this.validateNote(file)) return;
			if (!this.validateApiKeys()) return;

			// 노트 삭제 시 파인콘DB에서 삭제
			this.logger.info(`Note deleted: ${file.path}`);

			const pc = createPineconeClient(this.settings.pineconeApiKey);
			const pineconeIndex = pc.index(this.settings.selectedIndex);
			const deleteRequest = {
				filter: {
					filePath: { $eq: file.path },
				},
			};
			// FIXME: 삭제시 오류 발생
			await pineconeIndex.deleteMany({ deleteRequest: deleteRequest });

			new Notice("Note successfully deleted from PineconeDB");
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
