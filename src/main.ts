import { Document } from "@langchain/core/documents";
import {
	type FrontMatterCache,
	type Menu,
	Notice,
	Plugin,
	type TAbstractFile,
	TFile,
	TFolder,
} from "obsidian";
import { DEFAULT_MIN_TOKEN_COUNT, PLUGIN_APP_ID } from "./constants";
import DocumentProcessor from "./helpers/document/DocumentProcessor";
import { InLocalStore } from "./helpers/langchain/store/InLocalStore";
import { LogLevel, Logger } from "./helpers/logger";
import NoteHashStorage from "./helpers/storage/NoteHashStorage";
import calculateTokenCount from "./helpers/utils/calculateTokenCount";
import { getFileNameSafe } from "./helpers/utils/fileUtils";
import { createContentHash, createHash } from "./helpers/utils/hash";
import { createPineconeClient } from "./services/PineconeManager";
import { SettingTab } from "./settings/settingTab";
import { DEFAULT_SETTINGS, type PluginSettings } from "./settings/settings";
import type { NoteMetadata } from "./types";
import { SearchNotesModal } from "./ui/modals/SearchNotesModal";

export default class SmartSeekerPlugin extends Plugin {
	private logger = new Logger("SmartSeekerPlugin", LogLevel.DEBUG);
	private localStore: InLocalStore;
	private notesToSave: Record<string, Document> = {};
	private isProcessing = false;
	private hashStorage: NoteHashStorage;
	private documentProcessor: DocumentProcessor;
	settings: PluginSettings;

	private lastEditTime: number = Date.now();

	private registerVaultEvents(): void {
		if (!this.app.workspace.layoutReady) {
			this.logger.warn("Workspace not ready, skipping event registration");
			return;
		}

		// 노트 생성, 업데이트, 삭제 이벤트 감지
		this.registerEvent(
			this.app.vault.on("create", (file) =>
				this.handleNoteCreateOrUpdate(file),
			),
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				this.handleNoteCreateOrUpdate(file);
				this.updateLastEditTime(); // 수정 시 마지막 편집 시간 업데이트
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => this.handleNoteDelete(file)),
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
		this.registerInterval(
			window.setInterval(() => {
				if (this.app.workspace.layoutReady) {
					this.checkForIdleTime(); // 유휴 시간 체크
				}
			}, 10 * 1000),
		);
	}

	private async processFolderFiles(folder: TFolder): Promise<void> {
		this.logger.debug("selected folder:", folder);

		new Notice("🔍 폴더 내 노트를 검색 데이터베이스에 추가하는 중...");

		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path.startsWith(folder.path));

		new Notice(
			`📚 ${folder.name} 폴더에서 ${files.length}개의 노트를 찾았습니다.`,
		);

		const result = await this.documentProcessor.processMultiFiles(files);
		this.logger.debug(`[Process] Completed: ${result}`);
		new Notice("✅ 모든 노트가 검색 데이터베이스에 추가되었습니다.");
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

	private updateLastEditTime() {
		this.lastEditTime = Date.now();
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
			"Selected Index": this.settings.selectedIndex?.trim(),
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
				if (!this.settings.pineconeApiKey || !this.settings.selectedIndex) {
					new Notice("Please configure PineconeDB settings first");
					return;
				}
				new SearchNotesModal(
					this.app,
					this.settings.openAIApiKey,
					this.settings.pineconeApiKey,
					this.settings.selectedIndex,
				).open();
			},
		});
	}

	async onload() {
		await this.loadSettings();

		// 로그 수정
		this.logger = new Logger("SmartSeekerPlugin", this.settings.logLevel);

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

	/**
	 * 스케쥴러가 처리할 노트를 큐에 추가합니다
	 * @param file 노트의 파일
	 */
	private async addNoteToScheduler(file: TFile): Promise<void> {
		const filePath = file.path;

		// 이미 존재하는 경로인지 확인
		if (filePath in this.notesToSave) {
			console.debug(`이미 스케쥴러에 등록된 노트입니다: ${filePath}`);
			return;
		}

		try {
			const document = await this.createDocument(file);
			this.notesToSave[filePath] = document;

			console.debug(`노트가 스케쥴러에 추가되었습니다: ${filePath}`);
		} catch (error) {
			console.error(
				`노트를 스케쥴러에 추가하는 중 오류가 발생했습니다: ${error}`,
			);
		}
	}

	private async createDocument(file: TFile) {
		const content = await this.app.vault.read(file);
		const hash = await createContentHash(content);
		const id = await createHash(file.path);
		let pageContent = content;

		let frontmatter: FrontMatterCache | null = null;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			frontmatter = fm;
			pageContent = pageContent
				.substring(pageContent.indexOf("---", 3) + 3)
				.trim();
		});
		console.log("--→ frontmatter", frontmatter);

		const metadata: NoteMetadata = {
			...(frontmatter as unknown as NoteMetadata),
			id,
			hash,
			filePath: file.path,
			ctime: file.stat.ctime,
			mtime: file.stat.mtime,
			title: getFileNameSafe(file.path),
		};
		console.log("--→ metadata", frontmatter);

		const document = new Document({ pageContent, metadata });

		console.log("--→ document", document);
		return document;
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
			this.logger.error(`Failed to process note ${file.path}: ${errorMessage}`);
			new Notice(`Failed to process note: ${errorMessage}`);
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

	private async processNote(documents: Document<NoteMetadata>[]) {
		const { totalDocuments, skippedDocuments, processedDocuments } =
			await this.documentProcessor.processDocuments(documents);
		this.logger.debug(
			`${processedDocuments} notes successfully saved to PineconeDB`,
		);
		return { totalDocuments, skippedDocuments, processedDocuments };
	}

	private async processNoteQueue() {
		if (this.isProcessing) {
			this.logger.debug("🔄 Already processing notes, skipping...");
			return;
		}

		const noteCount = Object.keys(this.notesToSave).length;
		if (noteCount === 0) {
			this.logger.debug("📭 처리할 노트가 없습니다.");
			return;
		}

		this.isProcessing = true;
		const notesToProcess = { ...this.notesToSave };

		try {
			if (!this.validateApiKeys()) {
				throw new Error("API configuration is missing or invalid");
			}

			// documents를 배열로 변환
			const documents = Object.values(
				notesToProcess,
			) as Document<NoteMetadata>[];
			const { totalDocuments, skippedDocuments, processedDocuments } =
				await this.processNote(documents);
			this.logger.debug(
				`${processedDocuments} notes successfully saved to PineconeDB`,
			);

			// 상세한 결과 메시지 생성
			const resultMessage = this.createResultMessage(
				totalDocuments,
				processedDocuments,
				skippedDocuments,
			);

			// 로그와 알림 표시
			this.logger.debug(resultMessage);
			new Notice(resultMessage, 5000); // 5초간 표시

			// 처리된 노트 제거
			for (const key of Object.keys(notesToProcess)) {
				delete this.notesToSave[key];
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			const failedPaths = Object.keys(notesToProcess).join(", ");
			this.logger.error(
				`Failed to process notes (${failedPaths}): ${errorMessage}`,
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
			new Notice(`Note successfully deleted from PineconeDB: ${file.path}`);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			this.logger.error(`Failed to delete note ${file.path}: ${errorMessage}`);
			// new Notice(`Failed to delete note: ${errorMessage}`);
		}
	}
}
