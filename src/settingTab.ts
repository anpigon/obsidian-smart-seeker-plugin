import { IndexModel, Pinecone } from "@pinecone-database/pinecone";
import {
	App,
	Modal,
	Notice,
	PluginSettingTab,
	Setting,
	TextComponent,
} from "obsidian";
import { EMBEDDING_DIMENSION } from "./contants";
import MyPlugin from "./main";

export class SettingTab extends PluginSettingTab {
	plugin: MyPlugin;
	indexListEl: HTMLElement | null = null;
	indexSelectEl: HTMLSelectElement | null = null;

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

		// OpenAI API 설정
		new Setting(containerEl)
			.setName("OpenAI API 키")
			.setDesc("AI 기능 사용을 위한 OpenAI API 키를 입력하세요")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.openAIApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openAIApiKey = value;
						await this.plugin.saveSettings();
					});
			});

		// Pinecone API 설정
		new Setting(containerEl)
			.setName("Pinecone API 키")
			.setDesc(
				"벡터 데이터베이스 연동을 위한 Pinecone API 키를 입력하세요"
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("pc-...")
					.setValue(this.plugin.settings.pineconeApiKey)
					.onChange(async (value) => {
						this.plugin.settings.pineconeApiKey = value;
						await this.plugin.saveSettings();
					});
			});

		// 인덱스 관리 섹션
		containerEl.createEl("h3", { text: "Pinecone 인덱스 선택" });

		// 인덱스 선택 드롭다운
		const indexSetting = new Setting(containerEl)
			.setName("인덱스")
			.setDesc("사용할 Pinecone 인덱스를 선택하세요")
			.addDropdown((dropdown) => {
				dropdown.onChange(async (value) => {
					this.plugin.settings.selectedIndex = value;
					await this.plugin.saveSettings();
				});
				this.indexSelectEl = dropdown.selectEl;
			});

		// 새로고침 버튼
		indexSetting.addButton((button) =>
			button
				.setIcon("refresh-cw")
				.setTooltip("인덱스 목록 새로고침")
				.onClick(async () => {
					try {
						const indexes = await this.fetchPineconeIndexes();
						this.displayIndexes(indexes);
						new Notice("인덱스 목록을 새로고침했습니다");
					} catch (error) {
						new Notice(
							"인덱스 목록 조회 실패. API 키를 확인해주세요"
						);
						console.error("Failed to fetch indexes:", error);
					}
				})
		);

		// 파인콘 DB 인덱스 생성 버튼
		new Setting(containerEl)
			.setName("파인콘 DB 생성")
			.setDesc("새로운 Pinecone 인덱스를 생성합니다")
			.addButton((button) =>
				button.setButtonText("생성").onClick(() => {
					new CreatePineconeIndexModal(this.app, this.plugin).open();
				})
			);

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
		if (this.indexSelectEl !== null) {
			this.indexSelectEl.empty();
			indexes.forEach((index) => {
				const optionEl = this.indexSelectEl?.createEl("option", {
					text: index.name,
					value: index.name,
				});
				if (
					optionEl &&
					index.name === this.plugin.settings.selectedIndex
				) {
					optionEl.selected = true;
				}
			});
		}
	}
}

// 파인콘 인덱스 생성 다이아로그
class CreatePineconeIndexModal extends Modal {
	private indexNameInput: TextComponent;
	private readonly plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "새로운 파인콘 인덱스 생성" });

		new Setting(contentEl)
			.setName("인덱스 이름")
			.setDesc("생성할 인덱스의 이름을 입력하세요.")
			.addText((text) => {
				this.indexNameInput = text;
				text.setPlaceholder("my-index");
			});

		new Setting(contentEl).addButton((button) => {
			button
				.setButtonText("생성")
				.setCta()
				.onClick(async () => {
					const indexName = this.indexNameInput.getValue();
					if (!indexName) {
						new Notice("인덱스 이름을 입력하세요");
						return;
					}
					await this.createPineconeIndex(indexName);
					this.close();
				});
		});
	}

	async createPineconeIndex(indexName: string) {
		try {
			const pc = new Pinecone({
				apiKey: this.plugin.settings.pineconeApiKey,
			});
			await pc.createIndex({
				name: indexName,
				dimension: 1536,
				metric: "dotproduct",
				spec: {
					serverless: {
						cloud: "aws",
						region: "us-east-1",
					},
				},
			});
			new Notice(`인덱스 '${indexName}'가 생성되었습니다.`);
		} catch (error) {
			console.error("인덱스 생성 실패:", error);
			new Notice("인덱스 생성에 실패했습니다. API 키를 확인해주세요.");
		}
	}
}
