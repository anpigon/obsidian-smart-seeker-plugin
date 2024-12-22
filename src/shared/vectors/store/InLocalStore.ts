/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogLevel, Logger } from "@/shared/lib/logger";
import { BaseStore } from "@langchain/core/stores";
import type { Vault } from "obsidian";

export class InLocalStore<T = any> extends BaseStore<string, T> {
	private logger: Logger;
	private cacheFilePath: string;

	lc_namespace = ["langchain", "storage"];

	protected store: Record<string, T> = {};

	constructor(
		private vault: Vault,
		private pluginId: string,
	) {
		super();
		this.initialize();
	}

	private async initialize(): Promise<void> {
		this.logger = new Logger("InLocalStore", LogLevel.DEBUG);
		this.cacheFilePath = `${this.vault.configDir}/plugins/${this.pluginId}/cache.json`;

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
				this.store = JSON.parse(cacheContent);
				this.logger.debug("Cache loaded successfully");
			}
		} catch (error) {
			this.logger.error("Failed to initialize InLocalStore:", error);
			this.store = {};
		}
	}

	/**
	 * 캐시를 파일에 저장
	 */
	private async saveCache(): Promise<void> {
		try {
			const adapter = this.vault.adapter;
			await adapter.write(this.cacheFilePath, JSON.stringify(this.store));
		} catch (error) {
			this.logger.error("Error saving cache:", error);
		}
	}

	/**
	 * 여러 키에 대한 값들을 한번에 가져옴
	 */
	async mget(keys: string[]) {
		return keys.map((key) => this.store[key]);
	}

	/**
	 * 여러 키-값 쌍을 한번에 저장
	 */
	async mset(keyValuePairs: [string, T][]): Promise<void> {
		for (const [key, value] of keyValuePairs) {
			this.store[key] = value;
		}
		await this.saveCache();
		this.logger.debug("Cache updated successfully");
	}

	/**
	 * 여러 키를 한번에 삭제
	 */
	async mdelete(keys: string[]): Promise<void> {
		for (const key of keys) {
			delete this.store[key];
		}
		await this.saveCache();
		this.logger.debug("Cache entries removed successfully");
	}

	/**
	 * 저장소의 키들을 순회하는 제너레이터
	 * prefix가 주어지면 해당 접두어로 시작하는 키만 반환
	 */
	async *yieldKeys(prefix?: string): AsyncGenerator<string> {
		const keys = Object.keys(this.store);
		for (const key of keys) {
			if (prefix === undefined || key.startsWith(prefix)) {
				yield key;
			}
		}
	}
}
