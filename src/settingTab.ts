import { App, PluginSettingTab, Setting } from "obsidian";
import MyPlugin from "./main";

export class SettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// OpenAI API 키 입력 필드 생성
		new Setting(containerEl)
			.setName("OpenAI API Key")
			.setDesc("OpenAI API 키를 입력하세요")
			.addText((text) => {
				text.inputEl.type = 'password';
				return text
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.openAIApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openAIApiKey = value;
						await this.plugin.saveSettings();
					});
			});

		// 파인콘 벡터DB API 키 입력 필드 생성
		new Setting(containerEl)
			.setName("Pinecone API Key")
			.setDesc("Pinecone 벡터DB API 키를 입력하세요")
			.addText((text) => {
				text.inputEl.type = 'password';
				return text
					.setPlaceholder("pc-...")
					.setValue(this.plugin.settings.pineconeApiKey)
					.onChange(async (value) => {
						this.plugin.settings.pineconeApiKey = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
