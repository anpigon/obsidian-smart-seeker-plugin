import { BaseStore } from "@langchain/core/stores";
import { TFile, Vault } from "obsidian";
import { createHash } from "../utils/hash";
import { Logger, LogLevel } from "../utils/logger";

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

export class InLocalStore<T = unknown> extends BaseStore<string, T> {
	private cacheManager: CacheManager;

	lc_namespace = ["langchain", "storage"];

	constructor(private vault: Vault, private pluginId: string) {
		super();
		this.cacheManager = new CacheManager(vault, pluginId);
	}

	/**
	 * 여러 키에 대한 값들을 한번에 가져옴
	 */
	async mget(keys: string[]) {
		const results: T[] = [];
		for (const key of keys) {
			const value = await this.cacheManager.getEmbeddings(key);
			results.push(value as T);
		}
		return results;
	}

	/**
	 * 여러 키-값 쌍을 한번에 저장
	 */
	async mset(keyValuePairs: [string, T][]): Promise<void> {
		for (const [key, value] of keyValuePairs) {
			// CacheManager의 updateCache 메서드를 사용하되,
			// 파일과 컨텐츠 대신 키를 직접 사용
			await this.cacheManager.updateCache(
				{ path: key } as TFile, // 임시 TFile 객체 생성
				key, // 컨텐츠로 키를 사용
				value as number[] // T를 number[]로 캐스팅
			);
		}
	}

	/**
	 * 여러 키를 한번에 삭제
	 */
	async mdelete(keys: string[]): Promise<void> {
		for (const key of keys) {
			await this.cacheManager.removeFromCache(
				{ path: key } as TFile // 임시 TFile 객체 생성
			);
		}
	}

	/**
	 * 저장소의 키들을 순회하는 제너레이터
	 * prefix가 주어지면 해당 접두어로 시작하는 키만 반환
	 */
	async *yieldKeys(prefix?: string): AsyncGenerator<string> {
		// CacheManager의 cache 객체의 키들을 순회
		const keys = Object.keys(await this.cacheManager["cache"]);
		for (const key of keys) {
			if (prefix === undefined || key.startsWith(prefix)) {
				yield key;
			}
		}
	}
}
