import { Document } from "@langchain/core/documents";
import { PineconeStore } from "@langchain/pinecone";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Index as PineconeIndex } from "@pinecone-database/pinecone";
import {
	FrontMatterCache,
	Menu,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
} from "obsidian";
import {
	DEFAULT_CHUNK_OVERLAP,
	DEFAULT_CHUNK_SIZE,
	DEFAULT_MIN_TOKEN_COUNT,
	PLUGIN_APP_ID,
	ZERO_VECTOR,
} from "./constants";
import DocumentProcessor from "./helpers/document/DocumentProcessor";
import { InLocalStore } from "./helpers/langchain/store/InLocalStore";
import { Logger, LogLevel } from "./helpers/logger";
import NoteHashStorage from "./helpers/storage/NoteHashStorage";
import calculateTokenCount from "./helpers/utils/calculateTokenCount";
import { getFileNameSafe } from "./helpers/utils/fileUtils";
import getEmbeddingModel from "./helpers/utils/getEmbeddingModel";
import { createContentHash, createHash } from "./helpers/utils/hash";
import { createPineconeClient } from "./services/PineconeManager";
import { SettingTab } from "./settings/settingTab";
import { DEFAULT_SETTINGS, PluginSettings } from "./settings/settings";
import { NoteMetadata } from "./types";
import { SearchNotesModal } from "./ui/modals/SearchNotesModal";

export default class SmartSeekerPlugin extends Plugin {
	private logger = new Logger("SmartSeekerPlugin", LogLevel.DEBUG);
	private localStore: InLocalStore;
	private notesToSave: Record<string, Document> = {};
	private isProcessing = false;
	private hashStorage: NoteHashStorage;
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

		// 파일 탐색기의 폴더 컨텍스트 메뉴에 이벤트 리스너 추가
		this.registerEvent(
			this.app.workspace.on(
				"file-menu",
				(menu: Menu, fileOrFolder: TFile | TFolder) => {
					// folder가 TFolder 인스턴스인 경우에만 메뉴 추가
					if (fileOrFolder instanceof TFolder) {
						menu.addItem((item) => {
							item.setTitle("폴더 내 노트를 RAG 검색용으로 저장")
								.setIcon("folder")
								.onClick(async () => {
									console.log(
										"selected folder:",
										fileOrFolder
									);

									new Notice(
										"폴더 내 노트들을 처리중입니다..."
									);

									const files = this.app.vault
										.getMarkdownFiles()
										.filter((file) =>
											file.path.startsWith(
												fileOrFolder.path
											)
										);

									new Notice(
										`폴더 내에서 노트 ${files.length}개를 찾았습니다.`
									);

									for (const file of files) {
										await this.addNoteToScheduler(file);
									}
								});
						});
					} else if (
						fileOrFolder instanceof TFile &&
						fileOrFolder.extension === "md"
					) {
						menu.addItem((item) => {
							item.setTitle("노트를 RAG 검색용으로 저장")
								.setIcon("file")
								.onClick(async () => {
									console.log("selected file:", fileOrFolder);

									new Notice("노트를 처리중입니다...");

									await this.addNoteToScheduler(fileOrFolder);
								});
						});
					}
				}
			)
		);

		// 주기적인 임베딩 처리
		this.registerInterval(
			window.setInterval(() => {
				if (this.app.workspace.layoutReady) {
					this.processNoteQueue();
				}
			}, 10 * 1000)
		);
	}

	private async initializeNoteHashStorage() {
		if (!this.hashStorage) {
			this.hashStorage = new NoteHashStorage();
		}
	}

	private async initializeLocalStore() {
		if (!this.localStore) {
			// InLocalStore 초기화
			this.localStore = new InLocalStore(this.app.vault, PLUGIN_APP_ID);
		}
	}

	private validateApiKeys(): boolean {
		const requiredSettings = {
			"Pinecone API Key": this.settings.pineconeApiKey?.trim(),
			"OpenAI API Key": this.settings.openAIApiKey?.trim(),
			"Selected Index": this.settings.selectedIndex?.trim(),
		};

		const missingSettings = Object.entries(requiredSettings)
			.filter(([_, value]) => !value)
			.map(([key]) => key);

		if (missingSettings.length > 0) {
			this.logger.warn(
				`Missing required settings: ${missingSettings.join(", ")}`
			);
			return false;
		}

		return true;
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
			await this.initializeLocalStore();
			await this.initializeNoteHashStorage();
			this.registerVaultEvents();
		});

		// 명령어 추가
		this.addCommands();
	}

	async onunload() {
		try {
			// 남은 데이터 처리
			if (Object.keys(this.notesToSave).length > 0) {
				await this.processNoteQueue();
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

	async proccessFrotmatter(file: TFile) {
		return new Promise<FrontMatterCache>((resolve) =>
			this.app.fileManager.processFrontMatter(file, resolve)
		);
	}

	/**
	 * 스케쥴러가 처리할 노트를 큐에 추가합니다
	 * @param file 노트의 파일
	 */
	private async addNoteToScheduler(file: TFile): Promise<void> {
		const filePath = file.path;

		// 이미 존재하는 경로인지 확인
		if (this.notesToSave.hasOwnProperty(filePath)) {
			console.debug(`이미 스케쥴러에 등록된 노트입니다: ${filePath}`);
			return;
		}

		try {
			const pageContent = await this.app.vault.read(file);
			const metadata = await this.extractMetadata(file, pageContent);
			this.logger.debug("metadata", metadata);

			const document = new Document({ pageContent, metadata });
			this.notesToSave[filePath] = document;

			console.debug(`노트가 스케쥴러에 추가되었습니다: ${filePath}`);
		} catch (error) {
			console.error(
				`노트를 스케쥴러에 추가하는 중 오류가 발생했습니다: ${error}`
			);
		}
	}

	private async extractMetadata(
		file: TFile,
		content: string
	): Promise<NoteMetadata> {
		const id = await createHash(file.path);
		const hash = await createContentHash(content);

		const metadata: NoteMetadata = {
			id,
			hash,
			filePath: file.path,
			ctime: file.stat.ctime,
			mtime: file.stat.mtime,
			title: getFileNameSafe(file.path),
		};

		// const frontMatterMatch = await this.proccessFrotmatter(file);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let frontmatter: any = null;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			frontmatter = fm;
		});
		if (frontmatter) {
			return {
				...frontmatter,
				...metadata,
			};
		}

		return metadata;
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

	private async handleNoteCreateOrUpdate(file: TAbstractFile): Promise<void> {
		try {
			if (!this.validateNote(file)) return;
			if (!this.validateApiKeys()) return;

			this.logger.info(`Processing note: ${file.path}`);
			const content = await this.app.vault.cachedRead(file);

			if (!this.validateTokenCount(content)) return;

			await this.addNoteToScheduler(file);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			this.logger.error(
				`Failed to process note ${file.path}: ${errorMessage}`
			);
			new Notice(`Failed to process note: ${errorMessage}`);
		}
	}

	private async createDocumentChunksWithIds(documents: Document[]) {
		const textSplitter = new RecursiveCharacterTextSplitter({
			chunkSize: DEFAULT_CHUNK_SIZE,
			chunkOverlap: DEFAULT_CHUNK_OVERLAP,
		});

		const ids: string[] = [];
		const chunks: Document[] = [];
		for (const document of documents) {
			const splitDocuments = await textSplitter.splitDocuments(
				[document],
				{ appendChunkOverlapHeader: true }
			);
			for (let idx = 0; idx < splitDocuments.length; idx++) {
				const splitDocument = splitDocuments[idx];
				const hash = await createHash(splitDocument.metadata.filePath);
				ids.push(`${hash}-${idx}`);
				chunks.push(splitDocument);
			}
		}
		return { ids, chunks };
	}

	private async filterDocuments(
		pineconeIndex: PineconeIndex,
		documents: Document[]
	) {
		const filterPromises = documents.map(async (doc) => {
			try {
				const queryResult = await pineconeIndex.query({
					vector: ZERO_VECTOR,
					topK: 100,
					includeMetadata: true,
					filter: {
						filePath: doc.metadata.filePath,
					},
				});

				// 매치가 없거나 해시가 다른 경우에만 포함
				const shouldInclude =
					!queryResult.matches?.length ||
					queryResult.matches[0].metadata?.hash !== doc.metadata.hash;

				return shouldInclude ? doc : null;
			} catch (error) {
				console.error(
					`Error querying document ${doc.metadata.filePath}:`,
					error
				);
				return null;
			}
		});
		const results = await Promise.all(filterPromises);
		return results.filter((doc): doc is Document => doc !== null);
	}

	private async processNoteQueue() {
		if (this.isProcessing) {
			this.logger.debug("Already processing notes, skipping...");
			return;
		}

		if (Object.keys(this.notesToSave).length === 0) {
			this.logger.debug("not ...");
			return;
		}

		this.isProcessing = true;
		const notesToProcess = { ...this.notesToSave };

		try {
			// API 키 검증
			if (!this.validateApiKeys()) {
				throw new Error("API configuration is missing or invalid");
			}

			const pinecone = createPineconeClient(this.settings.pineconeApiKey);
			const pineconeIndex = pinecone.Index(this.settings.selectedIndex);

			// documents를 배열로 변환
			const documents = Object.values(notesToProcess);

			// ID 생성
			const documentIds = documents.map((doc) => `${doc.metadata.id}-0`);

			// Pinecone에서 기존 문서 조회
			const fetchResults = await pineconeIndex.fetch(documentIds);

			// 기존 문서의 해시값 추출
			const existingHashes = Object.values(fetchResults.records).map(
				(record) => (record.metadata as { hash: string }).hash
			);

			// 새로운 문서만 필터링
			const filterDocuments = documents.filter(
				(doc) => !existingHashes.includes(doc.metadata.hash)
			);

			console.log("documents", filterDocuments);
			const documentProcessor = new DocumentProcessor(this.settings);
			const { processedCount } = await documentProcessor.processDocuments(
				filterDocuments
			);
			if (processedCount > 0) {
				this.logger.debug(
					`${notesToProcess.length} notes successfully saved to PineconeDB`
				);
				new Notice(
					`${notesToProcess.length} notes successfully saved to PineconeDB`
				);
			}

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

	private async handleNoteDelete(file: TAbstractFile): Promise<void> {
		try {
			if (!this.validateNote(file)) return;
			if (!this.validateApiKeys()) return;

			this.logger.info(`Deleting note: ${file.path}`);

			await this.hashStorage.deleteHash(file.path);

			const pc = createPineconeClient(this.settings.pineconeApiKey);
			const pineconeIndex = pc.index(this.settings.selectedIndex);

			const deleteRequest = {
				filter: {
					filePath: file.path,
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
			// new Notice(`Failed to delete note: ${errorMessage}`);
		}
	}
}
