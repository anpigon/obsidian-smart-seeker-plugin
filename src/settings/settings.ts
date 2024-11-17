import { LogLevel } from "src/helpers/logger";

export interface PluginSettings {
	openAIApiKey: string;
	pineconeApiKey: string; // 파인콘 벡터DB API Key 추가
	pineconeIndexName: string; // 선택된 인덱스 추가
	pineconeEnvironment: string;
	logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	openAIApiKey: "",
	pineconeApiKey: "", // 기본값 설정
	pineconeIndexName: "", // 기본값 설정
	pineconeEnvironment: "aws/us-east-1",
	logLevel: LogLevel.DEBUG,
};
