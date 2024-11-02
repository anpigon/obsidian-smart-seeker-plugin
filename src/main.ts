import {
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
import { EMBEDDING_MODEL } from "./contants";
import { SettingTab } from "./settingTab";
import { DEFAULT_SETTINGS, PluginSettings } from "./settings";
import { getFileNameSafe } from "./utils/fileUtils";
import { createPathHash } from "./utils/hash";
import { createOpenAIClient } from "./utils/openai";
import { createPineconeClient } from "./utils/pinecone";

export default class SmartSeekerPlugin extends Plugin {
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
		const metadata = {
			filePath: file.path,
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
			model: EMBEDDING_MODEL,
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
			const hash = await createPathHash(file.path);
			const metadata = await this.extractMetadata(file, noteContent);

			const embeddings = await this.createEmbeddings(noteContent);
			await this.saveToPinecone(hash, embeddings, metadata);

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
			const hash = await createPathHash(file.path);
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
	constructor(
		app: App,
		private openAIApiKey: string,
		private pineconeApiKey: string,
		private selectedIndex: string
	) {
		super(app);
	}

	async getSuggestions(
		query: string
	): Promise<ScoredPineconeRecord<RecordMetadata>[]> {
		try {
			const pc = createPineconeClient(this.pineconeApiKey);
			const index = pc.index(this.selectedIndex);
			const results = await index.query({
				vector: await this.getQueryVector(query),
				topK: 10,
				includeMetadata: true,
			});

			return results.matches;
		} catch (error) {
			console.error("Search error:", error);
			new Notice("Failed to search notes");
			return [];
		}
	}

	private async getQueryVector(query: string): Promise<number[]> {
		const openai = createOpenAIClient(this.openAIApiKey);
		const response = await openai.embeddings.create({
			input: query,
			model: EMBEDDING_MODEL,
		});
		return response.data[0].embedding;
	}

	renderSuggestion(
		item: ScoredPineconeRecord<RecordMetadata>,
		el: HTMLElement
	) {
		const title = item.metadata?.title?.toString() || "Untitled";
		const score = item.score !== undefined ? item.score.toFixed(2) : "N/A"; // score가 undefined인 경우 "N/A"로 표시
		el.createEl("div", { text: `${title} (Score: ${score})` });
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
