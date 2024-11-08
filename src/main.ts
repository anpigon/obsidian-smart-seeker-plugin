import { Document } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { TokenTextSplitter } from "@langchain/textsplitters";
import { Index as PineconeIndex } from "@pinecone-database/pinecone";
import { getEncoding } from "js-tiktoken";
import { CacheBackedEmbeddings } from "langchain/embeddings/cache_backed";
import { Notice, parseYaml, Plugin, TAbstractFile, TFile } from "obsidian";
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE, DEFAULT_EMBEDDING_MODEL, DEFAULT_MIN_TOKEN_COUNT, PLUGIN_APP_ID } from "./constants";
import { InLocalStore } from "./helpers/langchain/store";
import { Logger, LogLevel } from "./helpers/logger";
import { getFileNameSafe } from "./helpers/utils/fileUtils";
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
		await this.loadSettings();

		// 설정 탭 추가
		this.addSettingTab(new SettingTab(this.app, this));

		// 워크스페이스가 준비된 후에 이벤트 리스너 등록
		this.app.workspace.onLayoutReady(() => {
			// InLocalStore 초기화
			this.localStore = new InLocalStore(this.app.vault, PLUGIN_APP_ID);

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

	private async splitContent(documents: Document[]) {
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
		ids?: Array<string>
	) {
		const pinecone = createPineconeClient(this.settings.pineconeApiKey);
		const pineconeIndex: PineconeIndex = pinecone.Index(
			this.settings.selectedIndex
		);
		const embedding = this.getEmbeddings();
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

	private getEmbeddings() {
		const underlyingEmbeddings = new OpenAIEmbeddings({
			openAIApiKey: this.settings.openAIApiKey,
			modelName: DEFAULT_EMBEDDING_MODEL,
		});
		const cacheBackedEmbeddings = CacheBackedEmbeddings.fromBytesStore(
			underlyingEmbeddings,
			this.localStore,
			{
				namespace: underlyingEmbeddings.modelName,
			}
		);
		return cacheBackedEmbeddings;
	}

	async handleNoteCreateOrUpdate(file: TAbstractFile): Promise<void> {
		try {
			if (!this.validateNote(file)) {
				return;
			}

			// 노트 생성 또는 업데이트 시 파인콘DB에 저장
			this.logger.info(`Note created or updated: ${file.path}`);
			const pageContent = await this.app.vault.read(file);

			// TODO: 토큰 수 계산 로직을 별도 유틸리티 함수로 분리
			const enc = getEncoding("cl100k_base");
			const tokenCount = enc.encode(pageContent).length;
			this.logger.debug("tokenCount", tokenCount);
			if (tokenCount < DEFAULT_MIN_TOKEN_COUNT) {
				this.logger.info(
					`Note skipped due to insufficient tokens: ${tokenCount}`
				);
				return;
			}

			// 메타 데이터 파싱하기
			const metadata = await this.extractMetadata(file, pageContent);

			// FIXME: 노트 청크 분할 로직 최적화 필요 - 현재 중복된 내용이 발생할 수 있음
			const chunks = await this.splitContent([
				new Document({ pageContent, metadata }),
			]);

			// Pinecone에 저장
			const ids = [];
			for (const chunk of chunks) {
				const cleaned = removeAllWhitespace(chunk.pageContent);
				const id = await createHash(cleaned);
				ids.push(id);
			}
			await this.saveToPinecone(chunks, ids);

			const noticeMessage = new DocumentFragment();
			noticeMessage.createDiv().innerHTML = `Note "${file.path}"<br/>successfully saved to PineconeDB`;
			new Notice(noticeMessage);
		} catch (error) {
			this.logger.error(`Failed to process note ${file.path}:`, error);
			new Notice(`Failed to save note "${file.path}" to PineconeDB`);
		}
	}

	async handleNoteDelete(file: TAbstractFile): Promise<void> {
		try {
			if (!this.validateNote(file)) {
				return;
			}

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
			this.logger.error(`Failed to delete note ${file.path}:`, error);
			new Notice("Failed to delete note from PineconeDB");
		}
	}
}
