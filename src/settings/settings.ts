import { LogLevel } from "src/helpers/logger";

export interface PluginSettings {
	openAIApiKey: string;
	pineconeApiKey: string; // 파인콘 벡터DB API Key 추가
	selectedIndex: string; // 선택된 인덱스 추가
	logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	openAIApiKey: "",
	pineconeApiKey: "", // 기본값 설정
	selectedIndex: "", // 기본값 설정
	logLevel: LogLevel.DEBUG
};
