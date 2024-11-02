import { Notice, parseYaml, Plugin, TAbstractFile, TFile } from "obsidian";
import { EMBEDDING_MODEL } from "./contants";
import { SettingTab } from "./settingTab";
import { DEFAULT_SETTINGS, PluginSettings } from "./settings";
import { createPathHash } from "./utils/hash";
import { createOpenAIClient } from "./utils/openai";
import { createPineconeClient } from "./utils/pinecone";

export default class MyPlugin extends Plugin {
	private readonly MARKDOWN_EXTENSION = "md";
	private readonly PINECONE_API_ENDPOINT = "https://api.pineconedb.com/notes";

	settings: PluginSettings;

	async onload() {
		await this.loadSettings();

		// 설정 탭 추가
		this.addSettingTab(new SettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
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

	async handleNoteCreateOrUpdate(file: TAbstractFile): Promise<void> {
		try {
			if (
				file instanceof TFile &&
				file.extension === this.MARKDOWN_EXTENSION
			) {
				// 노트 생성 또는 업데이트 시 파인콘DB에 저장
				console.log(`Note created or updated: ${file.path}`);

				// 노트 내용 읽기
				const noteContent = await this.app.vault.read(file);

				// 파일 경로로부터 해시 생성
				const hash = createPathHash(file.path);

				// 프론트매터 파싱
				const frontMatterMatch = noteContent.match(
					/^---\n([\s\S]+?)\n---/
				);
				let metadata = {};
				if (frontMatterMatch) {
					metadata = parseYaml(frontMatterMatch[1]);
				}

				const openai = createOpenAIClient(this.settings.openAIApiKey);
				const embeddings = await openai.embeddings.create({
					input: noteContent,
					model: EMBEDDING_MODEL,
				});

				console.log("노트 파일명", file.path);
				console.log("파인콘 인덱스", this.settings.selectedIndex);
				const pc = createPineconeClient(this.settings.pineconeApiKey);
				const index = pc.index(this.settings.selectedIndex);
				await index.upsert([
					{
						id: hash,
						values: embeddings.data[0].embedding,
						metadata: metadata,
					},
				]);

				console.log("Note successfully saved to PineconeDB");
				new Notice("Note successfully saved to PineconeDB");
			}
		} catch (error) {
			console.error("노트 처리 중 오류 발생:", error);
			new Notice("Failed to save note to PineconeDB");
		}
	}

	async handleNoteDelete(file: TAbstractFile): Promise<void> {
		try {
			if (
				file instanceof TFile &&
				file.extension === this.MARKDOWN_EXTENSION
			) {
				// 노트 삭제 시 파인콘DB에서 삭제
				console.log(`Note deleted: ${file.path}`);

				// 파일 경로로부터 해시 생성
				const hash = createPathHash(file.path);

				// Pinecone 클라이언트 생성 및 벡터 삭제
				const pc = createPineconeClient(this.settings.pineconeApiKey);
				const index = pc.index(this.settings.selectedIndex);
				await index.deleteMany([hash]);

				console.log("Note successfully deleted from PineconeDB");
				new Notice("Note successfully deleted from PineconeDB");
			}
		} catch (error) {
			console.error(`Failed to delete note ${file.path}:`, error);
			new Notice("Failed to delete note from PineconeDB");
		}
	}
}
