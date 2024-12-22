export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	NONE = 4,
}

export class Logger {
	private readonly prefix: string;
	private level: LogLevel;

	constructor(prefix: string, level: LogLevel = LogLevel.INFO) {
		this.prefix = `[${prefix}]`;
		this.level = level;
	}

	setLevel(level: LogLevel) {
		this.level = level;
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.DEBUG) {
			console.log(`${this.prefix} ${message}`, ...args);
		}
	}

	info(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.INFO) {
			console.info(`${this.prefix} ${message}`, ...args);
		}
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.WARN) {
			console.warn(`${this.prefix} ${message}`, ...args);
		}
	}

	error(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.ERROR) {
			console.error(`${this.prefix} ${message}`, ...args);
		}
	}
}
