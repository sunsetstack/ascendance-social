import "reflect-metadata";

import fs from "fs";
import path from "path";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { expect } from "chai";
import sinon from "sinon";

chai.use(chaiAsPromised);

type UnknownRecord = Record<string, unknown>;

const createLooseMock = (): any => {
	const stubs: Record<string | symbol, sinon.SinonStub> = {};

	return new Proxy(
		{},
		{
			get: (_target, prop: string | symbol) => {
				if (prop in stubs) return stubs[prop];

				if (prop === "executeInTransaction") {
					stubs[prop] = sinon.stub().callsFake(async (fn: any) => fn());
					return stubs[prop];
				}

				if (prop === "execute" || prop === "withResilience") {
					stubs[prop] = sinon.stub().callsFake(async (fn: any) => fn());
					return stubs[prop];
				}

				if (prop === "executeOrQueue") {
					stubs[prop] = sinon.stub().callsFake(async (op: any) => (typeof op === "function" ? op() : undefined));
					return stubs[prop];
				}

				stubs[prop] = sinon.stub().resolves(undefined);
				return stubs[prop];
			},
		},
	);
};

const walk = (dir: string): string[] => {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) results.push(...walk(full));
		else results.push(full);
	}
	return results;
};

const SRC_ROOT = path.resolve(__dirname, "..", "..");
const COMMANDS_ROOT = path.join(SRC_ROOT, "application", "commands");
const QUERIES_ROOT = path.join(SRC_ROOT, "application", "queries");

const isHandlerFile = (filePath: string): boolean => {
	if (!filePath.endsWith(".ts")) return false;
	if (filePath.endsWith(".test.ts")) return false;

	const base = path.basename(filePath);
	return base.endsWith(".handler.ts") || base.endsWith("Handler.ts");
};

interface HandlerExport {
	filePath: string;
	exportName: string;
	handlerClass: any;
}

const collectHandlerExports = (): { handlers: HandlerExport[]; loadErrors: Array<{ filePath: string; error: unknown }> } => {
	const handlerFiles = [...walk(COMMANDS_ROOT), ...walk(QUERIES_ROOT)].filter(isHandlerFile);

	const handlers: HandlerExport[] = [];
	const loadErrors: Array<{ filePath: string; error: unknown }> = [];

	for (const filePath of handlerFiles) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const mod = require(filePath) as UnknownRecord;

			for (const [exportName, exported] of Object.entries(mod)) {
				if (typeof exported !== "function") continue;
				const proto = (exported as any).prototype;
				if (!proto || typeof proto.execute !== "function") continue;

				handlers.push({ filePath, exportName, handlerClass: exported });
			}

			if (typeof (mod as any).default === "function") {
				const exported = (mod as any).default;
				const proto = exported?.prototype;
				if (proto && typeof proto.execute === "function") {
					handlers.push({ filePath, exportName: "default", handlerClass: exported });
				}
			}
		} catch (error) {
			loadErrors.push({ filePath, error });
		}
	}

	return { handlers, loadErrors };
};

describe("Command/Query handlers (smoke)", () => {
	afterEach(() => {
		sinon.restore();
	});

	const { handlers, loadErrors } = collectHandlerExports();

	for (const { filePath, error } of loadErrors) {
		it(`loads ${path.relative(SRC_ROOT, filePath)}`, () => {
			throw error;
		});
	}

	for (const { filePath, exportName, handlerClass } of handlers) {
		it(`executes ${path.relative(SRC_ROOT, filePath)}#${exportName} without hanging`, async function () {
			this.timeout(2000);

			const deps = Array.from({ length: 40 }, () => createLooseMock());
			const instance = new handlerClass(...(deps as any[]));

			expect(instance).to.have.property("execute");
			expect(instance.execute).to.be.a("function");

			const settle = Promise.resolve().then(() => instance.execute({} as any));
			await Promise.race([
				settle.then(
					() => undefined,
					() => undefined,
				),
				new Promise((_, reject) => setTimeout(() => reject(new Error("execute() did not settle")), 1000)),
			]);
		});
	}
});
