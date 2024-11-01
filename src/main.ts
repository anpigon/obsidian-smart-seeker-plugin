import { Plugin, TFile, TAbstractFile } from "obsidian";
import { SettingTab } from "./settingTab";
import { PluginSettings, DEFAULT_SETTINGS } from "./settings";

export default class MyPlugin extends Plugin {
	settings: PluginSettings;

	async onload() {
		await this.loadSettings();

		// 설정 탭 추가
		this.addSettingTab(new SettingTab(this.app, this));

		// 노트 생성, 업데이트, 삭제 이벤트 감지
		this.registerEvent(
			this.app.vault.on("create", this.handleNoteCreateOrUpdate.bind(this))
		);
		this.registerEvent(
			this.app.vault.on("modify", this.handleNoteCreateOrUpdate.bind(this))
		);
		this.registerEvent(
			this.app.vault.on("delete", this.handleNoteDelete.bind(this))
		);
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

	async handleNoteCreateOrUpdate(file: TAbstractFile) {
		if (file instanceof TFile && file.extension === "md") {
			// 노트 생성 또는 업데이트 시 파인콘DB에 저장
			console.log(`Note created or updated: ${file.path}`);
			// 파인콘DB에 저장하는 로직 추가
		}
	}

	async handleNoteDelete(file: TAbstractFile) {
		if (file instanceof TFile && file.extension === "md") {
			// 노트 삭제 시 파인콘DB에서 삭제
			console.log(`Note deleted: ${file.path}`);
			// 파인콘DB에서 삭제하는 로직 추가
		}
	}
}
