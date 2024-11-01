import { Plugin, TAbstractFile, TFile } from "obsidian";
import { SettingTab } from "./settingTab";
import { DEFAULT_SETTINGS, PluginSettings } from "./settings";

export default class MyPlugin extends Plugin {
	private readonly MARKDOWN_EXTENSION = "md";

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
				const payload = {
					path: file.path,
					content: noteContent,
				};

				// 파인콘DB API 호출
				const response = await fetch("https://api.pineconedb.com/notes", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Authorization": "Bearer YOUR_API_KEY", // API 키 필요
					},
					body: JSON.stringify(payload),
				});

				if (!response.ok) {
					throw new Error("Failed to save note to PineconeDB");
				}

				console.log("Note successfully saved to PineconeDB");
			}
		} catch (error) {
			console.error("노트 처리 중 오류 발생:", error);
		}
	}

	async handleNoteDelete(file: TAbstractFile): Promise<void> {
		if (
			file instanceof TFile &&
			file.extension === this.MARKDOWN_EXTENSION
		) {
			// 노트 삭제 시 파인콘DB에서 삭제
			console.log(`Note deleted: ${file.path}`);
			// 파인콘DB에서 삭제하는 로직 추가
		}
	}
}
