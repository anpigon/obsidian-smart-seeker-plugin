import { RecordMetadata } from "@pinecone-database/pinecone";
import { Notice, parseYaml, Plugin, TAbstractFile, TFile } from "obsidian";
import { SearchNotesModal } from "./modals/SearchNotesModal";
import { createOpenAIClient } from "./services/OpenAIManager";
import { createPineconeClient } from "./services/PineconeManager";
import { SettingTab } from "./settings/settingTab";
import { DEFAULT_SETTINGS, PluginSettings } from "./settings/settings";
import { NoteMetadata } from "./types";
import { getFileNameSafe } from "./utils/fileUtils";
import { createHash } from "./utils/hash";
import { Logger, LogLevel } from "./utils/logger";
import { CacheManager } from "./services/CacheManager";
import { DEFAULT_EMBEDDING_MODEL, PLUGIN_APP_ID } from "./constants";

export default class SmartSeekerPlugin extends Plugin {
	private logger = new Logger("SmartSeekerPlugin", LogLevel.INFO);
	private cacheManager: CacheManager;
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
	}

	async onload() {
		// CacheManager 초기화
		this.cacheManager = new CacheManager(this.app.vault, PLUGIN_APP_ID);

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

	async onunload() {
		// 설정 데이터 최종 저장
		try {
			await this.saveData(this.settings);
		} catch (error) {
			console.error("Failed to save settings on unload:", error);
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
		const maxTokens = 8192; // 최대 토큰 수 설정
		const contentChunks = this.splitContentIntoChunks(content, maxTokens);

		const embeddings = [];
		for (const chunk of contentChunks) {
			const response = await openai.embeddings.create({
				input: chunk,
				model: DEFAULT_EMBEDDING_MODEL,
			});
			embeddings.push(...response.data[0].embedding);
		}
		return embeddings;
	}

	private splitContentIntoChunks(content: string, maxTokens: number): string[] {
		const words = content.split(/\s+/);
		const chunks = [];
		for (let i = 0; i < words.length; i += maxTokens) {
			chunks.push(words.slice(i, i + maxTokens).join(' '));
		}
		return chunks;
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
			this.logger.info(`Note created or updated: ${file.path}`);

			const noteContent = await this.app.vault.read(file);

			// 노트의 토큰 수 계산
			const tokenCount = noteContent.split(/\s+/).length;
			if (tokenCount < 200) {
				this.logger.info(
					`Note skipped due to insufficient tokens: ${tokenCount}`
				);
				return;
			}

			// 캐시 체크
			if (await this.cacheManager.checkCache(file, noteContent)) {
				this.logger.debug(
					`Note skipped due to cache hit: ${file.path}`
				);
				return;
			}

			// 새로운 임베딩 생성
			const hash = await createHash(file.path);
			const metadata = await this.extractMetadata(file, noteContent);
			const embeddings = await this.createEmbeddings(noteContent);

			// Pinecone에 저장
			await this.saveToPinecone(hash, embeddings, metadata);

			// 캐시 업데이트
			await this.cacheManager.updateCache(file, noteContent, embeddings);

			// 캐시 크기 관리
			await this.cacheManager.pruneCache();

			new Notice("Note successfully saved to PineconeDB");
		} catch (error) {
			this.logger.error("노트 처리 중 오류 발생:", error);
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
			this.logger.info(`Note deleted: ${file.path}`);

			// 파일 경로로부터 해시 생성
			const hash = await createHash(file.path);
			const pc = createPineconeClient(this.settings.pineconeApiKey);
			const index = pc.index(this.settings.selectedIndex);
			await index.deleteMany([hash]);

			new Notice("Note successfully deleted from PineconeDB");
		} catch (error) {
			this.logger.error(`Failed to delete note ${file.path}:`, error);
			new Notice("Failed to delete note from PineconeDB");
		}
	}
}
