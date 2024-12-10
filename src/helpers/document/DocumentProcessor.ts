import SmartSeekerPlugin from "@/main";
import type { NoteMetadata } from "@/types";
import { Document } from "@langchain/core/documents";
import {
	MarkdownTextSplitter,
	type TextSplitter,
} from "@langchain/textsplitters";
import type {
	Index,
	PineconeRecord,
	QueryResponse,
	RecordMetadata,
} from "@pinecone-database/pinecone";
import { FrontMatterCache, Notice, TFile } from "obsidian";
import {
	DEFAULT_CHUNK_OVERLAP,
	DEFAULT_CHUNK_SIZE,
	ZERO_VECTOR,
} from "src/constants";
import { createPineconeClient } from "src/services/PineconeManager";
import type { PluginSettings } from "src/settings/settings";
import { PineconeStore } from "../langchain/vectorstores";
import { Logger } from "../logger";
import { delay } from "../utils/delay";
import { getFileNameSafe } from "../utils/fileUtils";
import getEmbeddingModel from "../utils/getEmbeddingModel";
import { createContentHash, createHash } from "../utils/hash";

interface DocumentChunk {
	ids: string[];
	chunks: Document[];
}

export default class DocumentProcessor {
	private logger: Logger;
	private settings: PluginSettings;
	private textSplitter: TextSplitter;
	private pineconeIndex: Index<RecordMetadata>;

	constructor(
		private plugin: SmartSeekerPlugin,
		private maxConcurrency = 5,
	) {
		this.settings = this.plugin.settings;
		this.logger = this.initializeLogger(plugin.settings);
		this.pineconeIndex = this.initializePineconeIndex(plugin.settings);
		this.textSplitter = this.initializeTextSplitter();
	}

	private initializeLogger(settings: PluginSettings): Logger {
		return new Logger(
			"SmartSeekerPlugin::DocumentProcessor",
			settings.logLevel,
		);
	}

	private initializeTextSplitter(): TextSplitter {
		return new MarkdownTextSplitter({
			chunkSize: DEFAULT_CHUNK_SIZE,
			chunkOverlap: DEFAULT_CHUNK_OVERLAP,
			keepSeparator: true,
		});
	}

	private initializePineconeIndex(
		settings: PluginSettings,
	): Index<RecordMetadata> {
		const pinecone = createPineconeClient(settings.pineconeApiKey);
		return pinecone.Index(settings.pineconeIndexName);
	}

	private generateDocumentIds(documents: Document[]): string[] {
		return documents.map((doc) => `${doc.metadata.id}-0`);
	}

	public async createDocumentsFromFiles(
		files: TFile[],
	): Promise<Document<NoteMetadata>[]> {
		const documents: Document<NoteMetadata>[] = [];
		for (const file of files) {
			const document = await this.createDocument(file);
			documents.push(document);
		}
		return documents;
	}

	private async createChunks(documents: Document[]): Promise<DocumentChunk> {
		const result: DocumentChunk = { ids: [], chunks: [] };

		for (const document of documents) {
			const splitDocuments = await this.textSplitter.splitDocuments(
				[document],
				{ appendChunkOverlapHeader: true },
			);

			for (const [idx, splitDocument] of splitDocuments.entries()) {
				const id = `${splitDocument.metadata.id}-${idx}`;
				result.ids.push(id);
				splitDocument.id = id;
				result.chunks.push(splitDocument);
			}
		}

		this.logger.debug(`Created chunks count: ${result.chunks.length}`);
		return result;
	}

	public async fetchExistingDocuments(documents: Document[]) {
		if (!documents?.length) return [];

		try {
			// 각 문서에 대한 고유 ID 생성
			const documentIds = this.generateDocumentIds(documents);
			// Pinecone DB에서 해당 ID들의 레코드 조회
			const results = await this.pineconeIndex.fetch(documentIds);
			return results;
		} catch (error) {
			this.logger.error("Error filtering documents:", error);
		}

		return [];
	}

	public async queryByFileContent(
		files: TFile[],
	): Promise<QueryResponse<RecordMetadata> | null> {
		if (!files?.length) return null;

		try {
			const hashes: string[] = [];
			for (const file of files) {
				const content = await this.plugin.app.vault.cachedRead(file);
				const hash = await createContentHash(content);
				hashes.push(hash);
			}

			const results = await this.pineconeIndex.query({
				vector: ZERO_VECTOR,
				topK: 100,
				includeValues: true,
				includeMetadata: true,
				filter: {
					hash: {
						$in: hashes,
					},
				},
			});
			return results;
		} catch (error) {
			this.logger.error("Error filtering documents:", error);
		}

		return null;
	}

	private async saveToVectorStore(chunks: Document[], ids: string[]) {
		const notice = new Notice(
			"🔍 검색 데이터베이스에 노트 저장을 시작하는 중...",
			0,
		);
		try {
			this.logger.debug("saveToVectorStore", { chunks, ids });

			// 기존 문서들의 고유 ID를 100개씩 나누어 조회
			const batchSize = 100;
			const records: Record<string, PineconeRecord<RecordMetadata>> = {};

			const totalChunks = chunks.length;
			notice.setMessage(
				`🔍 데이터베이스에서 기존 노트 청크를 조회하는 중... (0/${totalChunks}개)`,
			);
			for (let i = 0; i < ids.length; i += batchSize) {
				const batchIds = ids.slice(i, i + batchSize);
				const { records: batchRecords } =
					await this.pineconeIndex.fetch(batchIds);
				Object.assign(records, batchRecords);
				notice.setMessage(
					`🔍 데이터베이스에서 기존 노트 청크를 조회하는 중... (${i + Math.min(batchSize, batchIds.length)}/${totalChunks}개)`,
				);
			}
			await delay(500);
			this.logger.debug("records", records);

			// 기존 문서들의 해시값을 Set으로 저장
			const existingHashes = new Set(
				Object.values(records).map(
					(record) => (record.metadata as { hash: string }).hash,
				),
			);
			const newChunks = chunks.filter(
				(doc) => !existingHashes.has(doc.metadata.hash),
			);
			const existsChunks = chunks.filter((doc) =>
				existingHashes.has(doc.metadata.hash),
			);

			notice.setMessage(
				`🔍 새로운 노트 청크 ${newChunks.length}개, 업데이트가 필요한 노트 청크 ${existsChunks.length}개를 확인했습니다.`,
			);
			await delay(1000);

			this.logger.debug("--→ newChunks", newChunks);
			this.logger.debug("--→ existsChunks", existsChunks);

			const embedding = getEmbeddingModel(this.settings);
			const vectorStore = await PineconeStore.fromExistingIndex(embedding, {
				pineconeIndex: this.pineconeIndex,
				maxConcurrency: this.maxConcurrency,
			});

			// 기존 문서들의 고유-ID를 검색 데이터베이스에@update
			if (existsChunks.length > 0) {
				this.logger.debug("updateMetadata start");
				notice.setMessage(`🔄 기존 노트 청크 메타데이터 업데이트 중... (0%)`);
				const updates = existsChunks
					.filter((doc) => doc.id)
					.map((doc) => ({
						id: String(doc.id),
						metadata: doc.metadata,
						text: doc.pageContent,
					}));

				await vectorStore.updateMetadata(updates, {
					onProgress: (progress) => {
						this.logger.debug("updateMetadata progress", progress);
						notice.setMessage(
							`🔄 기존 노트 청크 메타데이터 업데이트 중... (${progress}%)`,
						);
					},
				});
				await delay(500);
			}

			if (newChunks.length === 0) {
				notice.setMessage(
					"✨ 모든 노트 청크가 검색 데이터베이스에 저장되었습니다.",
				);
				return {
					newChunks,
					skipChunks: existsChunks,
					vectorIds: [],
				};
			}

			this.logger.debug("saveToVectorStore save start");
			notice.setMessage(
				`📝 새로운 노트 청크 ${newChunks.length}개를 검색 데이터베이스에 저장하는 중... (0%)`,
			);
			const texts = newChunks.map(({ pageContent }) => pageContent);
			const newVectors = await vectorStore.embeddings.embedDocuments(texts);
			const newChunkIds = newChunks.map((e) => String(e.id));
			const vectorIds = await vectorStore.addVectors(newVectors, newChunks, {
				ids: newChunkIds,
				onProgress: (progress) => {
					this.logger.debug("saveToVectorStore save progress", progress);
					notice.setMessage(
						`📝 새로운 노트 청크를 검색 데이터베이스에 저장하는 중... (${progress}%)`,
					);
				},
			});
			await delay(500);
			this.logger.debug("saveToVectorStore save done", vectorIds);

			notice.setMessage(
				"✅ 모든 노트 청크가 검색 데이터베이스에 저장되었습니다.",
			);
			return {
				newChunks,
				skipChunks: existsChunks,
				vectorIds,
			};
		} finally {
			if (notice) {
				setTimeout(() => {
					notice.hide();
				}, 3000);
			}
		}
	}

	async filterDocumentsByQuery(documents: Document[]) {
		const filterPromises = documents.map(async (doc) => {
			try {
				const queryResult = await this.pineconeIndex.query({
					vector: ZERO_VECTOR,
					topK: 100,
					includeMetadata: true,
					filter: {
						filePath: doc.metadata.filePath,
					},
				});

				// 매치가 없거나 해시가 다른 경우에만 포함
				const shouldInclude =
					!queryResult.matches?.length ||
					queryResult.matches[0].metadata?.hash !== doc.metadata.hash;

				return shouldInclude ? doc : null;
			} catch (error) {
				console.error(
					`Error querying document ${doc.metadata.filePath}:`,
					error,
				);
				return null;
			}
		});
		const results = await Promise.all(filterPromises);
		return results.filter((doc): doc is Document => doc !== null);
	}

	private getParentPaths(file: TFile): string[] {
		const paths: string[] = [];
		let currentFolder = file.parent;

		while (currentFolder) {
			paths.unshift(currentFolder.path);
			currentFolder = currentFolder.parent;
		}

		return paths;
	}

	private async createDocument(file: TFile) {
		const content = await this.plugin.app.vault.cachedRead(file);
		const hash = await createContentHash(content);
		const id = await createHash(file.path);
		let pageContent = content;

		let frontmatter: FrontMatterCache | null = null;
		await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
			frontmatter = fm;
			pageContent = pageContent
				.substring(pageContent.indexOf("---", 3) + 3)
				.trim();
		});
		this.logger.debug("--→ frontmatter", frontmatter);

		const metadata: NoteMetadata = {
			...(frontmatter as unknown as NoteMetadata),
			id,
			hash,
			folderPaths: this.getParentPaths(file),
			filepath: file.path,
			filename: file.name,
			ctime: file.stat.ctime,
			mtime: file.stat.mtime,
			title: getFileNameSafe(file.path),
		};
		this.logger.debug("--→ metadata", metadata);

		const document = new Document({ pageContent, metadata });

		this.logger.debug("--→ document", document);
		return document;
	}

	// 기존 파인콘DB에 있는 문서는 필터링한다.
	public async filterNewOrUpdatedDocuments(
		documents: Document[],
	): Promise<Document[]> {
		if (!documents?.length) return [];

		try {
			// 각 문서에 대한 고유 ID 생성
			const documentIds = this.generateDocumentIds(documents);
			// Pinecone DB에서 해당 ID들의 레코드 조회
			const { records } = await this.pineconeIndex.fetch(documentIds);
			// 기존 문서들의 해시값을 Set으로 저장
			const existingHashes = new Set(
				Object.values(records).map(
					(record) => (record.metadata as { hash: string }).hash,
				),
			);
			// 새로운 문서나 업데이트된 문서만 필터링(기존 해시값과 일치하지 않는 문서만 반환)
			return documents.filter((doc) => !existingHashes.has(doc.metadata.hash));
		} catch (error) {
			this.logger.error("Error filtering documents:", error);
		}

		return [];
	}

	public async processSingleFile(file: TFile) {
		const document = await this.createDocument(file);
		const { ids, chunks } = await this.createChunks([document]);
		return await this.saveToVectorStore(chunks, ids);
	}

	public async processMultiFiles(files: TFile[]) {
		const documents = await this.createDocumentsFromFiles(files);
		const { ids, chunks } = await this.createChunks(documents);
		return await this.saveToVectorStore(chunks, ids);
	}
}
