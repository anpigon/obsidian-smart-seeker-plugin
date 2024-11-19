import { Pinecone } from "@pinecone-database/pinecone";
import {
	type FrontMatterCache,
	type Menu,
	Notice,
	Plugin,
	type TAbstractFile,
	TFile,
	TFolder,
	WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_MIN_TOKEN_COUNT, PLUGIN_APP_ID } from "./constants";
import DocumentProcessor from "./helpers/document/DocumentProcessor";
import { InLocalStore } from "./helpers/langchain/store/InLocalStore";
import { LogLevel, Logger } from "./helpers/logger";
import NoteHashStorage from "./helpers/storage/NoteHashStorage";
import calculateTokenCount from "./helpers/utils/calculateTokenCount";
import { createPineconeClient } from "./services/PineconeManager";
import { DEFAULT_SETTINGS, type PluginSettings } from "./settings/settings";
import { SettingTab } from "./settings/settingTab";
import { SearchNotesModal } from "./ui/modals/SearchNotesModal";
import {
	RelatedNotesView,
	VIEW_TYPE_RELATED_NOTES,
} from "./ui/RelatedNotesView";

export default class SmartSeekerPlugin extends Plugin {
	private logger = new Logger("SmartSeekerPlugin", LogLevel.DEBUG);
	private localStore: InLocalStore;
	private taskQueue: Record<string, TFile> = {};
	private isProcessing = false;
	private hashStorage: NoteHashStorage;
	private documentProcessor: DocumentProcessor;
	private pineconeClient: Pinecone;
	settings: PluginSettings;

	private lastEditTime: number = Date.now();

	private registerVaultEvents(): void {
		if (!this.app.workspace.layoutReady) {
			this.logger.warn("Workspace not ready, skipping event registration");
			return;
		}

		// 노트 생성, 업데이트, 삭제 이벤트 감지
		// this.registerEvent(
		// 	this.app.vault.on("create", async (file: TFile)) => this.onCreateOrModify(file)),
		// );

		// this.registerEvent(
		// 	this.app.vault.on("modify", async (file: TFile) => this.onCreateOrModify(file)),
		// );

		// this.registerEvent(this.app.metadataCache.on('changed', async (file: TFile) => this.onFileChange(file)));
		// this.registerEvent(this.app.vault.on('rename', async (file: TFile, oldPath: string) => this.onFileRename(file, oldPath)));

		this.registerEvent(
			this.app.vault.on("delete", async (file: TFile) =>
				this.onFileDelete(file),
			),
		);

		// 파일 탐색기의 폴더 컨텍스트 메뉴에 이벤트 리스너 추가
		this.registerEvent(
			this.app.workspace.on(
				"file-menu",
				(menu: Menu, fileOrFolder: TFile | TFolder) => {
					this.logger.debug("file or folder:", fileOrFolder);

					// folder가 TFolder 인스턴스인 경우에만 메뉴 추가
					if (fileOrFolder instanceof TFolder) {
						menu.addItem((item) => {
							item
								.setTitle("폴더 내 노트를 RAG 검색용으로 저장")
								.setSection("RAG 검색용")
								.setIcon("folder")
								.onClick(() => this.processFolderFiles(fileOrFolder));
						});
					} else if (
						fileOrFolder instanceof TFile &&
						fileOrFolder.extension === "md"
					) {
						menu.addItem((item) => {
							item
								.setTitle("노트를 RAG 검색용으로 저장")
								.setSection("RAG 검색용")
								.setIcon("file")
								.onClick(() => this.processFile(fileOrFolder));
						});
					}
				},
			),
		);

		// 주기적인 임베딩 처리
		// this.registerInterval(
		// 	window.setInterval(() => {
		// 		if (this.app.workspace.layoutReady) {
		// 			this.checkForIdleTime(); // 유휴 시간 체크
		// 		}
		// 	}, 10 * 1000),
		// );
	}

	private async processFolderFiles(folder: TFolder): Promise<void> {
		try {
			this.logger.debug("selected folder:", folder);

			const files = this.app.vault
				.getMarkdownFiles()
				.filter((file) => file.path.startsWith(folder.path));

			new Notice(
				`📚 ${folder.name} 폴더에서 ${files.length}개의 노트를 찾았습니다.`,
			);

			new Notice("🔍 폴더 내 노트를 검색 데이터베이스에 추가하는 중...");

			const documents =
				await this.documentProcessor.createDocumentsFromFiles(files);
			const filterDocuments =
				await this.documentProcessor.filterNewOrUpdatedDocuments(documents);
			const result =
				await this.documentProcessor.processMultiDocuments(filterDocuments);
			this.logger.debug(`[Process] Completed: ${result}`);

			const totalCount = files.length;
			const processedCount = filterDocuments.length;
			const skippedCount = totalCount - processedCount;
			const messgae = this.createResultMessage(
				totalCount,
				processedCount,
				skippedCount,
			);
			new Notice(messgae);
			new Notice("✅ 모든 노트가 검색 데이터베이스에 추가되었습니다.");
		} catch (e) {
			this.logger.error(e);
		}
	}

	private async processFile(file: TFile): Promise<void> {
		this.logger.debug("selected file:", file);
		new Notice("🔍 노트를 검색 데이터베이스에 추가하는 중...");

		try {
			const result = await this.documentProcessor.processSingleFile(file);
			this.logger.debug(`[Process] Completed: ${result}`);
			new Notice("✅ 노트가 검색 데이터베이스에 추가되었습니다.");
		} catch (error) {
			this.logger.error("Error processing note:", error);
			new Notice(`❌ 노트 처리 중 오류가 발생했습니다: ${error}`);
		}
	}

	private async checkForIdleTime() {
		const currentTime = Date.now();
		if (currentTime - this.lastEditTime >= 60 * 1000) {
			await this.processNoteQueue();
		}
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
			"Selected Index": this.settings.pineconeIndexName?.trim(),
		};

		const missingSettings = Object.entries(requiredSettings)
			.filter(([_, value]) => !value)
			.map(([key]) => key);

		if (missingSettings.length > 0) {
			this.logger.warn(
				`Missing required settings: ${missingSettings.join(", ")}`,
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
				if (!this.settings.pineconeApiKey || !this.settings.pineconeIndexName) {
					new Notice("Please configure PineconeDB settings first");
					return;
				}
				new SearchNotesModal(this.app, this.settings).open();
			},
		});
	}

	async onload() {
		await this.loadSettings();

		// 로그 수정
		this.logger = new Logger("SmartSeekerPlugin", this.settings.logLevel);

		// Initialize Pinecone client
		this.pineconeClient = createPineconeClient(this.settings.pineconeApiKey);

		// Register view
		this.registerView(
			VIEW_TYPE_RELATED_NOTES,
			(leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this.settings),
		);

		// Add icon to ribbon
		this.addRibbonIcon("documents", "Related Notes", () => {
			this.activateView();
		});

		// 설정 탭 추가
		this.addSettingTab(new SettingTab(this.app, this));

		// 워크스페이스가 준비된 후에 이벤트 리스너 등록
		this.app.workspace.onLayoutReady(async () => {
			this.documentProcessor = new DocumentProcessor(this);
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
			if (Object.keys(this.taskQueue).length > 0) {
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	changeLogLevel(logLevel: LogLevel) {
		this.logger.setLevel(logLevel);
	}

	async proccessFrotmatter(file: TFile) {
		return new Promise<FrontMatterCache>((resolve) =>
			this.app.fileManager.processFrontMatter(file, resolve),
		);
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
		minTokenCount: number = DEFAULT_MIN_TOKEN_COUNT,
	): boolean {
		try {
			const tokenCount = calculateTokenCount(text);
			this.logger.debug("Token count:", tokenCount);

			if (tokenCount < minTokenCount) {
				this.logger.info(
					`Note skipped due to insufficient tokens (${tokenCount}/${minTokenCount})`,
				);
				return false;
			}
			return true;
		} catch (error) {
			this.logger.error("Error calculating token count:", error);
			return false;
		}
	}

	private async onCreateOrModify(file: TAbstractFile): Promise<void> {
		try {
			if (!this.validateNote(file)) return;
			if (!this.validateApiKeys()) return;

			const filePath = file.path;
			this.logger.info(`Processing note: ${filePath}`);

			// const content = await this.app.vault.cachedRead(file);
			// if (!this.validateTokenCount(content)) return;

			this.taskQueue[filePath] = file;

			this.logger.debug(`노트가 스케쥴러에 추가되었습니다: ${filePath}`);

			// 마지막 편집 시간 업데이트
			this.lastEditTime = Date.now();
			this.logger.debug(
				`마지막 편집 시간 업데이트 완료: ${new Date(this.lastEditTime)}`,
			);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			this.logger.error(`Failed to process note ${file.path}: ${errorMessage}`);
		}
	}

	private createResultMessage(
		total: number,
		processed: number,
		skipped: number,
	): string {
		const parts = [];

		if (processed > 0) {
			parts.push(`✅ ${processed}개 저장 완료`);
		}

		if (skipped > 0) {
			parts.push(`⏭️ ${skipped}개 건너뜀`);
		}

		const summary = parts.join(" | ");
		return `📊 총 ${total}개 노트 처리\n${summary}`;
	}

	private async processNoteQueue() {
		if (this.isProcessing) {
			this.logger.debug("🔄 Already processing notes, skipping...");
			return;
		}

		if (Object.keys(this.taskQueue).length === 0) return;

		this.isProcessing = true;

		try {
			if (!this.validateApiKeys()) {
				throw new Error("API configuration is missing or invalid");
			}

			const files = Object.values(this.taskQueue);
			await this.documentProcessor.processMultiFiles(files);
			const totalCount = files.length;

			this.logger.debug(`${totalCount} notes successfully saved to PineconeDB`);

			new Notice(`📊 총 ${totalCount}개 노트 처리`, 5000);

			// 처리된 노트 제거
			for (const file of files) {
				delete this.taskQueue[file.path];
			}
		} catch (error) {
			this.logger.error(
				`Failed to process notes: ${error?.message || error.toString()}`,
			);
		} finally {
			this.isProcessing = false;
		}
	}

	private async onFileDelete(file: TAbstractFile): Promise<void> {
		try {
			if (file.path in this.taskQueue) delete this.taskQueue[file.path];

			if (!this.validateNote(file)) return;
			if (!this.validateApiKeys()) return;

			this.logger.info(`Deleting note: ${file.path}`);

			await this.hashStorage.deleteHash(file.path);

			const pc = createPineconeClient(this.settings.pineconeApiKey);
			const pineconeIndex = pc.index(this.settings.pineconeIndexName);

			const deleteRequest = {
				filter: {
					filePath: file.path,
				},
			};

			await pineconeIndex.deleteMany({ deleteRequest });
			new Notice(`Note successfully deleted from PineconeDB: ${file.path}`);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			this.logger.error(`Failed to delete note ${file.path}: ${errorMessage}`);
			// new Notice(`Failed to delete note: ${errorMessage}`);
		}
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_RELATED_NOTES);

		if (leaves.length > 0) {
			// View already exists, show it
			leaf = leaves[0];
			workspace.revealLeaf(leaf);
		} else {
			// Create new leaf
			leaf = workspace.getRightLeaf(false);
			if (leaf)
				await leaf.setViewState({
					type: VIEW_TYPE_RELATED_NOTES,
					active: true,
				});
		}
	}
}
