import { InMemoryStore } from "@langchain/core/stores";
import { OpenAIEmbeddings } from "@langchain/openai";
import { CacheBackedEmbeddings } from "langchain/embeddings/cache_backed";
import { DEFAULT_EMBEDDING_MODEL } from "src/constants";
import type { PluginSettings } from "src/settings/settings";

export default function getEmbeddingModel(settings: PluginSettings) {
	const underlyingEmbeddings = new OpenAIEmbeddings({
		openAIApiKey: settings.openAIApiKey,
		modelName: DEFAULT_EMBEDDING_MODEL,
	});
	const cacheBackedEmbeddings = CacheBackedEmbeddings.fromBytesStore(
		underlyingEmbeddings,
		// FIXME: localStore에 임베딩을 저장할 때 직렬화/역직렬화 과정에서 불일치 오류가 자주 발생하며, 원인은 JSON.stringify 과정에서 부동 소수점 숫자에서 정밀도 손실이 발생함.
		// this.localStore,
		new InMemoryStore(),
		// new IndexedDBStore(PLUGIN_APP_ID),
		{
			namespace: underlyingEmbeddings.modelName,
		},
	);
	return cacheBackedEmbeddings;
}
