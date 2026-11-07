import { describe, expect, test } from "bun:test";
import { type Api, Effort, type Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createExtensionModelQuery } from "../../src/extensibility/extensions/model-api";

function model(id: string, name: string, provider: string): Model<"anthropic-messages"> {
	return buildModel({
		id,
		name,
		api: "anthropic-messages",
		provider,
		baseUrl: "https://example.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
	});
}

const claude = model("claude-opus-4-8", "Claude Opus 4.8", "anthropic");
const claudePrev = model("claude-opus-4-7", "Claude Opus 4.7", "anthropic");
const gpt = model("gpt-5.4", "GPT-5.4", "openai");

const available = [claude, gpt] as Model<Api>[];

/** Minimal registry stub: only the methods the facade and core resolver touch. */
function registry(): ModelRegistry {
	return {
		getAvailable: () => available,
	} as unknown as ModelRegistry;
}

describe("createExtensionModelQuery", () => {
	test("current() reflects the live session model, read lazily", () => {
		let active: Model<Api> | undefined = claude;
		const q = createExtensionModelQuery(registry(), undefined, () => active);
		expect(q.current()).toBe(claude);
		active = gpt;
		expect(q.current()).toBe(gpt);
	});

	test("resolve() matches model strings through the core resolver", () => {
		const q = createExtensionModelQuery(registry(), undefined, () => undefined);
		expect(q.resolve("anthropic/claude-opus-4-8")).toBe(claude);
		expect(q.resolve("gpt-5.4")?.provider).toBe("openai");
		expect(q.resolve("definitely-not-a-model")).toBeUndefined();
	});

	test("resolve() honors configured role aliases via the same settings-backed path as core", () => {
		const settings = Settings.isolated({ modelRoles: { slow: "anthropic/claude-opus-4-8" } });
		const q = createExtensionModelQuery(registry(), settings, () => undefined);
		expect(q.resolve("@slow")).toBe(claude);
	});

	test("resolveSelection() keeps the thinking level a role configures, which resolve() drops", () => {
		const settings = Settings.isolated({ modelRoles: { slow: "anthropic/claude-opus-4-8:high" } });
		const q = createExtensionModelQuery(registry(), settings, () => undefined);
		expect(q.resolveSelection("@slow")).toEqual({ model: claude, thinkingLevel: Effort.High });
		expect(q.resolveSelection("gpt-5.4")).toEqual({ model: gpt, thinkingLevel: undefined });
		expect(q.resolveSelection("definitely-not-a-model")).toBeUndefined();
	});

	test("resolveSelection() takes the level from the role pattern that matched", () => {
		// The first pattern names an unavailable model, so its level must not leak onto the fallback.
		const settings = Settings.isolated({
			modelRoles: { slow: "openai/missing-model:xhigh, anthropic/claude-opus-4-8:medium" },
		});
		const q = createExtensionModelQuery(registry(), settings, () => undefined);
		expect(q.resolveSelection("@slow")).toEqual({ model: claude, thinkingLevel: Effort.Medium });
	});

	test("resolveSelection() lets an explicit suffix override the role's level", () => {
		const settings = Settings.isolated({ modelRoles: { slow: "anthropic/claude-opus-4-8:high" } });
		const q = createExtensionModelQuery(registry(), settings, () => undefined);
		expect(q.resolveSelection("@slow:low")).toEqual({ model: claude, thinkingLevel: Effort.Low });
	});

	test("resolveSelection() treats a model id that ends in a level as the id, not a level", () => {
		const router = model("local-router:low", "Local Router", "local");
		const q = createExtensionModelQuery(
			{ getAvailable: () => [router, gpt] } as unknown as ModelRegistry,
			undefined,
			() => undefined,
		);
		expect(q.resolveSelection("local/local-router:low")).toEqual({ model: router, thinkingLevel: undefined });
	});

	test("family() groups a vendor's point releases and separates vendors", () => {
		const q = createExtensionModelQuery(registry(), undefined, () => undefined);
		expect(q.family(claude)).toBe(q.family(claudePrev));
		expect(q.family(claude)).not.toBe(q.family(gpt));
	});
});
