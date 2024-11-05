import { TFile, Vault } from "obsidian";
import { createHash } from "../helpers/utils/hash";
import { Logger, LogLevel } from "../helpers/utils/logger";

interface CacheData {
	[key: string]: number[]; // 파일 경로+내용 해시: 임베딩 벡터
}

export class CacheManager {
	private cacheFilePath: string;
	private logger: Logger;
	private cache: CacheData = {};

	constructor(private vault: Vault, private pluginId: string) {
		this.logger = new Logger("CacheManager", LogLevel.DEBUG);
		this.cacheFilePath = `${this.vault.configDir}/plugins/${this.pluginId}/cache.json`;
		this.initializeCache();
	}

	private async initializeCache(): Promise<void> {
		try {
			const adapter = this.vault.adapter;
			const pluginDir = `${this.vault.configDir}/plugins/${this.pluginId}`;

			// 플러그인 디렉토리가 없으면 생성
			if (!(await adapter.exists(pluginDir))) {
				await adapter.mkdir(pluginDir);
			}

			// 캐시 파일이 있으면 로드
			if (await adapter.exists(this.cacheFilePath)) {
				const cacheContent = await adapter.read(this.cacheFilePath);
				this.cache = JSON.parse(cacheContent);
				this.logger.debug("Cache loaded successfully");
			}
		} catch (error) {
			this.logger.error("Failed to initialize cache:", error);
			this.cache = {};
		}
	}

	/**
	 * 파일의 캐시 상태를 확인
	 * @returns true if cache exists and is valid, false otherwise
	 */
	public async checkCache(file: TFile, content: string): Promise<boolean> {
		try {
			const cacheKey = await createHash(file.path + content);
			return !!this.cache[cacheKey];
		} catch (error) {
			this.logger.error("Error checking cache:", error);
			return false;
		}
	}

	/**
	 * 캐시에서 임베딩 벡터 가져오기
	 */
	public async getEmbeddings(cacheKey: string): Promise<number[] | null> {
		try {
			return this.cache[cacheKey] || null;
		} catch (error) {
			this.logger.error("Error getting embeddings from cache:", error);
			return null;
		}
	}

	/**
	 * 새로운 임베딩 벡터를 캐시에 저장
	 */
	public async updateCache(
		file: TFile,
		content: string,
		embeddings: number[]
	): Promise<void> {
		try {
			const cacheKey = await createHash(file.path + content);
			this.cache[cacheKey] = embeddings;
			await this.saveCache();
			this.logger.debug("Cache updated successfully");
		} catch (error) {
			this.logger.error("Error updating cache:", error);
		}
	}

	/**
	 * 캐시에서 파일 관련 데이터 삭제
	 */
	public async removeFromCache(file: TFile): Promise<void> {
		try {
			const keysToDelete = Object.keys(this.cache).filter((key) =>
				key.includes(file.path)
			);

			keysToDelete.forEach((key) => delete this.cache[key]);
			await this.saveCache();
			this.logger.debug("Cache entries removed successfully");
		} catch (error) {
			this.logger.error("Error removing from cache:", error);
		}
	}

	/**
	 * 캐시를 파일에 저장
	 */
	private async saveCache(): Promise<void> {
		try {
			const adapter = this.vault.adapter;
			await adapter.write(
				this.cacheFilePath,
				JSON.stringify(this.cache, null, 2)
			);
		} catch (error) {
			this.logger.error("Error saving cache:", error);
		}
	}

	/**
	 * 캐시 크기 관리
	 */
	public async pruneCache(maxEntries = 10000): Promise<void> {
		const entries = Object.entries(this.cache);
		if (entries.length > maxEntries) {
			this.cache = Object.fromEntries(entries.slice(-maxEntries));
			await this.saveCache();
			this.logger.debug("Cache pruned successfully");
		}
	}
}
