import { IndexModel, Pinecone } from "@pinecone-database/pinecone";
import { App, PluginSettingTab, Setting } from "obsidian";
import MyPlugin from "./main";
import { EMBEDDING_DIMENSION } from "./contants";

export class SettingTab extends PluginSettingTab {
	plugin: MyPlugin;
	indexListEl: HTMLElement | null = null;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async initialize() {
		const indexes = await this.fetchPineconeIndexes();
		this.displayIndexes(indexes);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// OpenAI API 키 입력 필드 생성
		new Setting(containerEl)
			.setName("OpenAI API Key")
			.setDesc("OpenAI API 키를 입력하세요")
			.addText((text) => {
				text.inputEl.type = "password";
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
				text.inputEl.type = "password";
				return text
					.setPlaceholder("pc-...")
					.setValue(this.plugin.settings.pineconeApiKey)
					.onChange(async (value) => {
						this.plugin.settings.pineconeApiKey = value;
						await this.plugin.saveSettings();
					});
			});

		// 인덱스 목록을 표시할 컨테이너 생성
		containerEl.createEl("h3", { text: "Pinecone 인덱스 선택" });

		// 인덱스 목록 가져오기 버튼 생성
		new Setting(containerEl)
			.setName("인덱스 목록 가져오기")
			.setDesc("Pinecone에서 생성된 인덱스 목록을 가져옵니다.")
			.addButton((button) => {
				button.setButtonText("새로고침").onClick(async () => {
					try {
						const indexes = await this.fetchPineconeIndexes();
						this.displayIndexes(indexes);
					} catch (error) {
						console.error(
							"인덱스 목록을 가져오는데 실패했습니다:",
							error
						);
						// 에러 메시지 표시
						if (this.indexListEl) {
							this.indexListEl.empty();
							this.indexListEl.createEl("p", {
								text: "인덱스 목록을 가져오는데 실패했습니다. API 키를 확인해주세요.",
								cls: "error-message",
							});
						}
					}
				});
			});

		// 인덱스 목록을 표시할 영역 생성
		this.indexListEl = containerEl.createEl("div", {
			cls: "index-list-container",
		});

		this.initialize();
	}

	// Pinecone API를 호출하여 인덱스 목록을 가져오는 함수
	async fetchPineconeIndexes(): Promise<IndexModel[]> {
		const pc = new Pinecone({
			apiKey: this.plugin.settings.pineconeApiKey,
		});
		const { indexes = [] } = await pc.listIndexes();
		return indexes.filter((e) => e.dimension === EMBEDDING_DIMENSION);
	}

	// 인덱스 목록을 화면에 표시하는 함수
	displayIndexes(indexes: IndexModel[]): void {
		if (!this.indexListEl) return;

		this.indexListEl.empty();

		if (indexes.length === 0) {
			this.indexListEl.createEl("p", {
				text: "생성된 인덱스가 없습니다.",
				cls: "no-indexes-message",
			});
			return;
		}

		// 드롭다운 메뉴 생성
		const selectEl = this.indexListEl.createEl("select", {
			cls: "index-select",
		});

		indexes.forEach((index) => {
			const optionEl = selectEl.createEl("option", {
				text: index.name,
				value: index.name,
			});
			if (index.name === this.plugin.settings.selectedIndex) {
				optionEl.selected = true;
			}
		});

		selectEl.onchange = async () => {
			this.plugin.settings.selectedIndex = selectEl.value;
			await this.plugin.saveSettings();
		};

		this.indexListEl.appendChild(selectEl);
	}
}
