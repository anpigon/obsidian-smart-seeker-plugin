import { Notice, Plugin, requestUrl, TAbstractFile, TFile } from "obsidian";
import { SettingTab } from "./settingTab";
import { DEFAULT_SETTINGS, PluginSettings } from "./settings";

interface NotePayload {
	path: string;
	content: string;
}

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

				// 파인콘DB에 저장하는 로직 추가
				const noteContent = await this.app.vault.read(file);
				const payload: NotePayload = {
					path: file.path,
					content: noteContent,
				};

				// 파인콘DB API 호출
				const response = await requestUrl({
					url: this.PINECONE_API_ENDPOINT,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.settings.pineconeApiKey}`,
					},
					body: JSON.stringify(payload),
				});

				if (response.status >= 400) {
					throw new Error(
						`Failed to save note to PineconeDB: ${response.status}`
					);
				}

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

				// requestUrl을 사용하여 파인콘DB에서 삭제
				const response = await requestUrl({
					url: `${this.PINECONE_API_ENDPOINT}/${encodeURIComponent(
						file.path
					)}`,
					method: "DELETE",
					headers: {
						Authorization: `Bearer ${this.settings.pineconeApiKey}`,
					},
				});

				if (response.status >= 400) {
					throw new Error(
						`Failed to delete note from PineconeDB: ${response.status}`
					);
				}

				console.log("Note successfully deleted from PineconeDB");
				new Notice("Note successfully deleted from PineconeDB");
			}
		} catch (error) {
			console.error(`Failed to delete note ${file.path}:`, error);
			new Notice("Failed to delete note from PineconeDB");
		}
	}
}
