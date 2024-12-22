import type SmartSeekerPlugin from "@/app/main";
import {
	DEFAULT_EMBEDDING_DIMENSION,
	PINECONE_CONFIG,
} from "@/shared/constants";
import { LogLevel } from "@/shared/lib/logger";
import { createPineconeClient } from "@/shared/services/PineconeManager";
import {
	type App,
	Modal,
	Notice,
	PluginSettingTab,
	Setting,
	TextComponent,
} from "obsidian";

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
			.setDesc(this.createOpenAIApiKeyDescription())
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
			.setDesc(this.createPineconeApiKeyDescription())
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
		containerEl.createEl("h3", { text: "Pinecone 인덱스" });

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
						new Notice(
							"인덱스 목록 조회 실패. API 키를 확인해주세요"
						);
						console.error("Failed to fetch indexes:", error);
					}
				})
		);

		// Pinecone DB 인덱스 생성 버튼
		new Setting(containerEl)
			.setName("Pinecone 인덱스 생성")
			.setDesc("새로운 Pinecone 인덱스를 생성합니다")
			.addButton((button) =>
				button.setButtonText("생성").onClick(() => {
					new CreatePineconeIndexModal(
						this.app,
						this.plugin,
						async (indexName: string) => {
							await this.fetchPineconeIndexes(indexName);
						}
					).open();
				})
			);

		// 개발자 옵션 섹션
		containerEl.createEl("h3", { text: "개발자 옵션" });

		// 로깅 레벨 설정
		new Setting(containerEl)
			.setName("로깅 레벨")
			.setDesc(
				"개발자 로깅 레벨을 설정합니다. DEBUG는 모든 로그를, ERROR는 오류 로그만 표시합니다."
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption(LogLevel.DEBUG.toString(), "DEBUG")
					.addOption(LogLevel.INFO.toString(), "INFO")
					.addOption(LogLevel.WARN.toString(), "WARN")
					.addOption(LogLevel.ERROR.toString(), "ERROR")
					.addOption(LogLevel.NONE.toString(), "NONE")
					.setValue(this.plugin.settings.logLevel.toString())
					.onChange(async (value) => {
						this.plugin.settings.logLevel = parseInt(value);
						await this.plugin.saveSettings();
					});
			});

		this.initialize();
	}

	private createApiKeyDescription(
		description: string,
		linkUrl: string
	): DocumentFragment {
		const fragment = document.createDocumentFragment();
		fragment.append(
			description,
			document.createElement("br"),
			"키 발급 바로가기: "
		);
		const a = document.createElement("a", { is: "external-link" });
		a.href = linkUrl;
		a.text = linkUrl;
		a.target = "_blank";
		fragment.append(a);
		return fragment;
	}

	private createPineconeApiKeyDescription(): DocumentFragment {
		return this.createApiKeyDescription(
			"벡터 데이터베이스 연동을 위한 Pinecone API 키를 입력하세요.",
			"https://app.pinecone.io/organizations/-/projects/-/keys"
		);
	}

	private createOpenAIApiKeyDescription(): DocumentFragment {
		return this.createApiKeyDescription(
			"OpenAI API 키를 입력하세요.",
			"https://platform.openai.com/api-keys"
		);
	}

	// Pinecone API를 호출하여 인덱스 목록을 가져오는 함수
	async fetchPineconeIndexes(selectIndex?: string) {
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
				(e) => e.dimension === DEFAULT_EMBEDDING_DIMENSION
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
						const optionEl = this.indexSelectEl?.createEl(
							"option",
							{
								text: name,
								value: name,
							}
						);

						// 새로 생성된 인덱스나 이전에 선택된 인덱스 선택
						if (
							name === selectIndex ||
							(!selectIndex &&
								name === this.plugin.settings.pineconeIndexName)
						) {
							(optionEl as HTMLOptionElement).selected = true;
							// 설정에 저장
							this.plugin.settings.pineconeIndexName = name;
							this.plugin.saveSettings();
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
	private onIndexCreated: (indexName: string) => Promise<void>;

	constructor(
		app: App,
		plugin: SmartSeekerPlugin,
		onIndexCreated: (indexName: string) => Promise<void>
	) {
		super(app);
		this.plugin = plugin;
		this.onIndexCreated = onIndexCreated;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "새로운 Pinecone 인덱스 생성" });

		const indexNameInputContainer = new Setting(contentEl)
			.setName("생성할 인덱스의 이름을 입력하세요.")
			.setDesc(
				"인덱스 이름은 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다."
			)
			.addText((text) => {
				text.setPlaceholder("인덱스 이름을 입력하세요")
					.onChange((value) => {
						// 입력값이 유효한지 확인
						const isValid = /^[a-z0-9-]*$/.test(value);
						submitButton.disabled = !isValid || !value;

						if (!isValid && value) {
							text.inputEl.addClass("invalid");
							indexNameInputContainer.descEl.addClass("error");
						} else {
							text.inputEl.removeClass("invalid");
							indexNameInputContainer.descEl.removeClass("error");
						}
					})
					.inputEl.addClass("index-name-input");
				this.indexNameInput = text;
			});

		// buttons
		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		const submitButton = buttonContainer.createEl("button", {
			text: "생성",
			cls: "mod-cta",
		});
		submitButton.disabled = true;

		submitButton.addEventListener("click", async () => {
			const indexName = this.indexNameInput.getValue();
			if (!indexName) {
				new Notice("인덱스 이름을 입력하세요");
				return;
			}

			submitButton.disabled = true;
			try {
				new Notice(`"${indexName}" 인덱스 생성 중...`);
				await this.createPineconeIndex(indexName);
				new Notice(`인덱스 '${indexName}'가 생성되었습니다.`);
				// 콜백 함수를 통해 인덱스 목록 새로고침 및 새로 생성된 인덱스 선택
				await this.onIndexCreated(indexName);
				this.close();
			} catch (error) {
				console.error("인덱스 생성 실패:", error);
				new Notice(
					"인덱스 생성에 실패했습니다. API 키를 확인해주세요."
				);
			} finally {
				submitButton.disabled = false;
			}
		});

		buttonContainer
			.createEl("button", { text: "취소" })
			.addEventListener("click", () => {
				this.close();
			});
	}

	async createPineconeIndex(indexName: string) {
		const pc = createPineconeClient(this.plugin.settings.pineconeApiKey);
		await pc.createIndex({
			name: indexName,
			dimension: DEFAULT_EMBEDDING_DIMENSION,
			metric: PINECONE_CONFIG.metric,
			spec: {
				...PINECONE_CONFIG.spec,
			},
		});
		await this.onIndexCreated(indexName);
	}
}
