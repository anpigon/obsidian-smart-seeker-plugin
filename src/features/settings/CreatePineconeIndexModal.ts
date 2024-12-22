import type SmartSeekerPlugin from "@/app/main";
import {
	DEFAULT_EMBEDDING_DIMENSION,
	PINECONE_CONFIG,
} from "@/shared/constants";
import { createPineconeClient } from "@/shared/services/PineconeManager";
import { type App, Modal, Notice, Setting, TextComponent } from "obsidian";

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

export default CreatePineconeIndexModal;
