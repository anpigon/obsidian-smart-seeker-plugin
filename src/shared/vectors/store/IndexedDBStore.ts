import { LogLevel, Logger } from "@/shared/lib/logger";
import { BaseStore } from "@langchain/core/stores";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class IndexedDBStore<T = unknown> extends BaseStore<string, T> {
	private logger: Logger;
	private dbName: string;
	private storeName: string;
	private db: IDBDatabase | null = null;

	lc_namespace = ["langchain", "storage"];

	constructor(dbName: string, storeName = "keyval") {
		super();
		this.dbName = dbName;
		this.storeName = storeName;
		this.logger = new Logger("IndexedDBStore", LogLevel.DEBUG);
		this.initialize();
	}

	private async initialize(): Promise<void> {
		try {
			this.db = await this.openDB();
			// Verify the store exists
			const storeNames = Array.from(this.db.objectStoreNames);
			if (!storeNames.includes(this.storeName)) {
				// Version vor dem Schließen speichern
				const currentVersion = this.db ? this.db.version : 1;
				this.db.close();
				this.db = null;
				// Neue DB mit erhöhter Version öffnen
				this.db = await this.openDB(currentVersion + 1);
			}
			this.logger.debug("IndexedDB initialized successfully");
		} catch (error) {
			this.logger.error("Failed to initialize IndexedDB:", error);
			throw error; // Propagate the error
		}
	}

	private openDB(version?: number): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, version);

			request.onerror = () => {
				this.logger.error("Error opening database:", request.error);
				reject(request.error);
			};

			request.onsuccess = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.close();
					// Recursively try to open with a new version if store doesn't exist
					this.openDB((db.version || 1) + 1)
						.then(resolve)
						.catch(reject);
					return;
				}
				resolve(db);
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName);
					this.logger.debug(`Created object store: ${this.storeName}`);
				}
			};
		});
	}

	private async getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
		if (!this.db) {
			this.db = await this.openDB();
		}
		const transaction = this.db.transaction(this.storeName, mode);
		return transaction.objectStore(this.storeName);
	}

	async mget(keys: string[]): Promise<(T | undefined)[]> {
		try {
			const store = await this.getStore("readonly");
			const promises = keys.map(
				(key) =>
					new Promise<T | undefined>((resolve) => {
						const request = store.get(key);
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => resolve(undefined);
					}),
			);
			return Promise.all(promises);
		} catch (error) {
			this.logger.error("Error in mget:", error);
			return new Array(keys.length).fill(undefined);
		}
	}

	async mset(keyValuePairs: [string, T][]): Promise<void> {
		try {
			const store = await this.getStore("readwrite");
			const promises = keyValuePairs.map(
				([key, value]) =>
					new Promise<void>((resolve, reject) => {
						const request = store.put(value, key);
						request.onsuccess = () => resolve();
						request.onerror = () => reject(request.error);
					}),
			);
			await Promise.all(promises);
			this.logger.debug("Data stored successfully");
		} catch (error) {
			this.logger.error("Error in mset:", error);
			throw error;
		}
	}

	async mdelete(keys: string[]): Promise<void> {
		try {
			const store = await this.getStore("readwrite");
			const promises = keys.map(
				(key) =>
					new Promise<void>((resolve, reject) => {
						const request = store.delete(key);
						request.onsuccess = () => resolve();
						request.onerror = () => reject(request.error);
					}),
			);
			await Promise.all(promises);
			this.logger.debug("Keys deleted successfully");
		} catch (error) {
			this.logger.error("Error in mdelete:", error);
			throw error;
		}
	}

	async *yieldKeys(prefix?: string): AsyncGenerator<string> {
		try {
			const store = await this.getStore("readonly");
			const request = store.openCursor();

			while (true) {
				const cursor = await new Promise<IDBCursorWithValue | null>(
					(resolve, reject) => {
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => reject(request.error);
					},
				);

				if (!cursor) {
					break;
				}

				const key = cursor.key.toString();
				if (!prefix || key.startsWith(prefix)) {
					yield key;
				}

				cursor.continue();
			}
		} catch (error) {
			this.logger.error("Error in yieldKeys:", error);
			throw error;
		}
	}
}
