import {
	type App,
	Modal,
	Notice,
	PluginSettingTab,
	Setting,
	type TextComponent,
} from "obsidian";
import { DEFAULT_EMBEDDING_DIMENSION, PINECONE_CONFIG } from "src/constants";
import { createPineconeClient } from "src/services/PineconeManager";
import type SmartSeekerPlugin from "../main";

export class SettingTab extends PluginSettingTab {
	plugin: SmartSeekerPlugin;
	indexListEl: HTMLElement | null = null;
	indexSelectEl: HTMLSelectElement | null = null;

	constructor(app: App, plugin: SmartSeekerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async initialize() {
		await this.fetchPineconeIndexes();
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
				text
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.openAIApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openAIApiKey = value;
						await this.plugin.saveSettings();
					});
			});

		// Pinecone API 설정
		new Setting(containerEl)
			.setName("Pinecone API 키")
			.setDesc("벡터 데이터베이스 연동을 위한 Pinecone API 키를 입력하세요")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("pc-...")
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
			.setName("Pinecone 인덱스")
			.setDesc("사용할 Pinecone 인덱스를 선택하세요")
			.addDropdown((dropdown) => {
				dropdown.onChange(async (value) => {
					this.plugin.settings.pineconeIndexName = value;
					await this.plugin.saveSettings();
				});
				this.indexSelectEl = dropdown.selectEl;
			});

		// 새로고침 버튼
		indexSetting.addButton((button) =>
			button
				.setIcon("refresh-cw")
				.setTooltip("Pinecone 인덱스 목록 새로고침")
				.onClick(async () => {
					try {
						await this.fetchPineconeIndexes();
						new Notice("인덱스 목록을 새로고침했습니다");
					} catch (error) {
						new Notice("인덱스 목록 조회 실패. API 키를 확인해주세요");
						console.error("Failed to fetch indexes:", error);
					}
				}),
		);

		// Pinecone DB 인덱스 생성 버튼
		new Setting(containerEl)
			.setName("Pinecone 인덱스 생성")
			.setDesc("새로운 Pinecone 인덱스를 생성합니다")
			.addButton((button) =>
				button.setButtonText("생성").onClick(() => {
					new CreatePineconeIndexModal(this.app, this.plugin).open();
				}),
			);

		this.initialize();
	}

	// Pinecone API를 호출하여 인덱스 목록을 가져오는 함수
	async fetchPineconeIndexes() {
		const pc = createPineconeClient(this.plugin.settings.pineconeApiKey);
		if (this.indexSelectEl) {
			// 로딩 상태 표시
			this.indexSelectEl.empty();
			const optionEl = this.indexSelectEl.createEl("option", {
				text: "인덱스 목록을 불러오는 중...",
				value: "",
			});
			optionEl.disabled = true;
		}
		try {
			const { indexes = [] } = await pc.listIndexes();
			const filteredIndexes = indexes.filter(
				(e) => e.dimension === DEFAULT_EMBEDDING_DIMENSION,
			);

			if (this.indexSelectEl) {
				this.indexSelectEl.empty();

				// 인덱스가 없는 경우
				if (filteredIndexes.length === 0) {
					const optionEl = this.indexSelectEl.createEl("option", {
						text: "사용 가능한 인덱스가 없습니다",
						value: "",
					});
					optionEl.disabled = true;
				} else {
					for (const { name } of filteredIndexes) {
						const optionEl = this.indexSelectEl?.createEl("option", {
							text: name,
							value: name,
						});

						if (name === this.plugin.settings.pineconeIndexName) {
							(optionEl as HTMLOptionElement).selected = true;
						}
					}
				}
			}
		} catch (error) {
			if (this.indexSelectEl) {
				this.indexSelectEl.empty();
				const optionEl = this.indexSelectEl.createEl("option", {
					text: "인덱스 목록 로딩 실패",
					value: "",
				});
				optionEl.disabled = true;
			}
			console.error("Failed to fetch indexes:", error);
		}
	}
}

// Pinecone 인덱스 생성 다이아로그
class CreatePineconeIndexModal extends Modal {
	private indexNameInput: TextComponent;
	private readonly plugin: SmartSeekerPlugin;

	constructor(app: App, plugin: SmartSeekerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "새로운 Pinecone 인덱스 생성" });

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
			const pc = createPineconeClient(this.plugin.settings.pineconeApiKey);
			await pc.createIndex({
				name: indexName,
				dimension: DEFAULT_EMBEDDING_DIMENSION,
				metric: PINECONE_CONFIG.metric,
				spec: {
					...PINECONE_CONFIG.spec,
				},
			});
			new Notice(`인덱스 '${indexName}'가 생성되었습니다.`);
		} catch (error) {
			console.error("인덱스 생성 실패:", error);
			new Notice("인덱스 생성에 실패했습니다. API 키를 확인해주세요.");
		}
	}
}
