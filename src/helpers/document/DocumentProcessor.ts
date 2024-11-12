import { Document } from "@langchain/core/documents";
import { PineconeStore } from "@langchain/pinecone";
import {
	RecursiveCharacterTextSplitter,
	TextSplitter,
} from "@langchain/textsplitters";
import { Index, RecordMetadata } from "@pinecone-database/pinecone";
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from "src/constants";
import { createPineconeClient } from "src/services/PineconeManager";
import { PluginSettings } from "src/settings/settings";
import { Logger } from "../logger";
import getEmbeddingModel from "../utils/getEmbeddingModel";
import { createHash } from "../utils/hash";

interface ProcessingResult {
	processedCount: number
}

export default class DocumentProcessor {
	private logger: Logger;
	private textSplitter: TextSplitter;
	private pineconeIndex: Index<RecordMetadata>;

	constructor(private settings: PluginSettings) {
		this.logger = new Logger(
			"SmartSeekerPlugin::DocumentProcessor",
			settings.logLevel
		);

		this.textSplitter = new RecursiveCharacterTextSplitter({
			chunkSize: DEFAULT_CHUNK_SIZE,
			chunkOverlap: DEFAULT_CHUNK_OVERLAP,
		});

		const pinecone = createPineconeClient(this.settings.pineconeApiKey);
		this.pineconeIndex = pinecone.Index(this.settings.selectedIndex);
	}

	async processDocuments(documents: Document[]): Promise<ProcessingResult> {
		const { ids, chunks } = await this.createChunks(documents);
		await this.saveToVectorStore(chunks, ids);
		return { processedCount: chunks.length };
	}

	private async createChunks(documents: Document[]) {
		const ids: string[] = [];
		const chunks: Document[] = [];
		for (const document of documents) {
			const splitDocuments = await this.textSplitter.splitDocuments(
				[document],
				{ appendChunkOverlapHeader: true }
			);

			for (const [idx, splitDocument] of splitDocuments.entries()) {
				const hash = await createHash(splitDocument.metadata.filePath);
				ids.push(`${hash}-${idx}`);
				chunks.push(splitDocument);
			}
		}
		this.logger.debug(`chunks: ${chunks.length}`);
		return { ids, chunks };
	}

	private async saveToVectorStore(
		chunks: Document[],
		ids: string[]
	): Promise<string[]> {
		const embedding = getEmbeddingModel(this.settings);
		const vectorStore = await PineconeStore.fromExistingIndex(embedding, {
			pineconeIndex: this.pineconeIndex,
			maxConcurrency: 5,
		});
		return await vectorStore.addDocuments(chunks, { ids });
	}
}
