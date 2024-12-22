import type SmartSeekerPlugin from "@/app/main";
import AppProvider from "@/app/provider";
import { DEFAULT_EMBEDDING_DIMENSION } from "@/shared/constants";
import { useApp, usePlugin, useSettings } from "@/shared/hooks";
import { LogLevel } from "@/shared/lib/logger";
import { createPineconeClient } from "@/shared/services/PineconeManager";
import IconRefresh from "@/widgets/icons/IconRefresh";
import { SettingItem } from "@/widgets/SettingItem";
import { useQuery } from "@tanstack/react-query";
import { type App, Notice, PluginSettingTab } from "obsidian";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import CreatePineconeIndexModal from "./CreatePineconeIndexModal";

enum SettingTabKey {
	OPENAI_API = 0,
	PINECONE_API = 1,
}

export default class SmartSeekerSettingTab extends PluginSettingTab {
	root: Root | null = null;
	plugin: SmartSeekerPlugin;
	indexListEl: HTMLElement | null = null;
	indexSelectEl: HTMLSelectElement | null = null;

	constructor(app: App, plugin: SmartSeekerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.root = createRoot(containerEl);

		this.root?.render(
			<StrictMode>
				<AppProvider app={this.app} plugin={this.plugin}>
					<SettingTab />
				</AppProvider>
			</StrictMode>,
		);
	}

	hide(): void {
		this.root?.unmount();
		super.hide();
	}
}

const SettingTab: React.FC = () => {
	const app = useApp();
	const plugin = usePlugin();
	const settings = useSettings();

	const [pineconeIndex, setPineconeIndex] = useState<string | null>(null);

	const handlePineconeIndexChange = useCallback(
		async (e: React.ChangeEvent<HTMLSelectElement>) => {
			setPineconeIndex(e.target.value);
			settings.pineconeIndexName = e.target.value;
			await plugin.saveSettings();
		},
		[plugin, settings],
	);

	// Pinecone API를 호출하여 인덱스 목록을 가져오는 함수
	const fetchPineconeIndexes = async () => {
		const pc = createPineconeClient(settings.pineconeApiKey);
		const { indexes = [] } = await pc.listIndexes();
		const filteredIndexes = indexes.filter(
			(e) => e.dimension === DEFAULT_EMBEDDING_DIMENSION,
		);
		return filteredIndexes;
	};

	const {
		data: pineconeIndexes,
		refetch: refetchPineconeIndexes,
		isLoading,
		isRefetching,
		isError,
		error,
	} = useQuery({
		queryKey: ["pinecone-indexes"],
		queryFn: fetchPineconeIndexes,
	});

	const isFetching = isLoading || isRefetching;

	useEffect(() => {
		if (pineconeIndexes && pineconeIndexes.length > 0) {
			const selected = pineconeIndexes.find(
				({ name }) => name === settings.pineconeIndexName,
			);
			if (!selected) {
				settings.pineconeIndexName = pineconeIndexes[0].name;
				plugin.saveSettings();
			}
			setPineconeIndex(settings.pineconeIndexName);
		}
	}, [pineconeIndexes, plugin, settings, settings.pineconeIndexName]);

	useEffect(() => {
		if (isError) {
			console.error("Failed to fetch indexes:", error);
			new Notice("인덱스 목록 조회 실패. API 키를 확인해주세요");
		}
	}, [isError, error]);

	const createApiKeyDescription = useCallback(
		(description: string, link: string) => {
			return (
				<>
					{description}
					<br />키 발급 바로가기: <a href={link}>{link}</a>
				</>
			);
		},
		[],
	);

	const handleOpenAIApiKeyChange = useCallback(
		(key: SettingTabKey) => async (e: React.ChangeEvent<HTMLInputElement>) => {
			const apiKeyMap = {
				[SettingTabKey.OPENAI_API]: () =>
					(settings.openAIApiKey = e.target.value),
				[SettingTabKey.PINECONE_API]: () =>
					(settings.pineconeApiKey = e.target.value),
			};

			apiKeyMap[key]?.();
			await plugin.saveSettings();
		},
		[plugin, settings],
	);

	return (
		<>
			<SettingItem heading name="API 키 설정" />
			<SettingItem
				name="OpenAI API 키"
				description={createApiKeyDescription(
					"OpenAI API 키를 입력하세요.",
					"https://platform.openai.com/api-keys",
				)}
			>
				<input
					type="password"
					spellCheck={false}
					placeholder="sk-..."
					defaultValue={settings.openAIApiKey}
					onChange={handleOpenAIApiKeyChange.bind(SettingTabKey.OPENAI_API)}
				/>
			</SettingItem>
			<SettingItem
				name="Pinecone API 키"
				description={createApiKeyDescription(
					"벡터 데이터베이스 연동을 위한 Pinecone API 키를 입력하세요.",
					"https://app.pinecone.io/organizations/-/projects/-/keys",
				)}
			>
				<input
					type="password"
					spellCheck={false}
					placeholder="pc-..."
					defaultValue={settings.pineconeApiKey}
					onChange={handleOpenAIApiKeyChange.bind(SettingTabKey.PINECONE_API)}
				/>
			</SettingItem>

			<SettingItem heading name="Pinecone 인덱스 설정" />
			<SettingItem
				name="Pinecone 인덱스"
				description="사용할 Pinecone 인덱스를 선택하세요"
			>
				<select
					className="dropdown"
					disabled={isFetching || pineconeIndexes?.length === 0}
					value={pineconeIndex ?? ""}
					onChange={handlePineconeIndexChange}
				>
					{isFetching && <option>인덱스 목록을 불러오는 중...</option>}
					{!isFetching &&
						pineconeIndexes?.map(({ name }) => (
							<option key={name} value={name}>
								{name}
							</option>
						))}
					{!isFetching && pineconeIndexes?.length === 0 && (
						<option>사용 가능한 인덱스가 없습니다</option>
					)}
					{isError && <option>인덱스 목록 조회 실패</option>}
				</select>
				<button
					aria-label="Pinecone 인덱스 목록 새로고침"
					type="button"
					onClick={async () => {
						try {
							await refetchPineconeIndexes();
							new Notice("인덱스 목록을 새로고침했습니다");
						} catch (error) {
							new Notice("인덱스 목록 조회 실패. API 키를 확인해주세요");
							console.error("Failed to fetch indexes:", error);
						}
					}}
				>
					<IconRefresh />
				</button>
			</SettingItem>
			<SettingItem
				name="Pinecone 인덱스 생성"
				description="새로운 Pinecone 인덱스를 생성합니다"
			>
				<button
					onClick={async () => {
						await new CreatePineconeIndexModal(
							app,
							plugin,
							async (indexName: string) => {
								await refetchPineconeIndexes();
								setPineconeIndex(indexName);
								settings.pineconeIndexName = indexName;
								plugin.saveSettings();
							},
						).open();
					}}
				>
					생성
				</button>
			</SettingItem>

			<SettingItem heading name="개발자 옵션" />
			<SettingItem
				name="로깅 레벨"
				description="개발자 로깅 레벨을 설정합니다. DEBUG는 모든 로그를, ERROR는 오류 로그만 표시합니다."
			>
				<select
					className="dropdown"
					onChange={async (e) => {
						settings.logLevel =
							(parseInt(e.target.value) as LogLevel) ?? LogLevel.INFO;
						await plugin.saveSettings();
					}}
				>
					<option value={LogLevel.DEBUG.toString()}>DEBUG</option>
					<option value={LogLevel.INFO.toString()}>INFO</option>
					<option value={LogLevel.WARN.toString()}>WARN</option>
					<option value={LogLevel.ERROR.toString()}>ERROR</option>
					<option value={LogLevel.NONE.toString()}>NONE</option>
				</select>
			</SettingItem>
		</>
	);
};
