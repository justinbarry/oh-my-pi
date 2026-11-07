/**
 * Model query facade exposed to extensions as `ctx.models`.
 *
 * Read-only: lets an extension select a model the same way core does — list
 * authenticated models, read the session model, resolve a model string or role
 * alias, and compare model families — without touching the mutable registry or
 * duplicating resolution/family heuristics.
 */
import type { Api, Model } from "@oh-my-pi/pi-ai";
import type { ModelRegistry } from "../../config/model-registry";
import { getModelMatchPreferences, resolveModelRoleValue } from "../../config/model-resolver";
import type { Settings } from "../../config/settings";
import type { ExtensionModelQuery, ExtensionModelSelection } from "./types";

/**
 * Build the `ctx.models` facade. `getModel` is read lazily so `current()` always
 * reflects the live session model (it can change mid-session via `/model`).
 */
export function createExtensionModelQuery(
	modelRegistry: ModelRegistry,
	settings: Settings | undefined,
	getModel: () => Model | undefined,
): ExtensionModelQuery {
	// resolveModelRoleValue expands a role alias (`@slow`) to its full configured
	// priority list and tries each pattern — the same path core selection uses — so a
	// fallback model lower in the list still resolves. Plain model strings pass through
	// as a single pattern.
	const resolveRole = (spec: string) =>
		resolveModelRoleValue(spec, modelRegistry.getAvailable(), {
			settings,
			matchPreferences: getModelMatchPreferences(settings),
		});
	return {
		list: () => modelRegistry.getAvailable(),
		current: () => getModel(),
		resolve: (spec: string): Model<Api> | undefined => resolveRole(spec).model,
		resolveSelection: (spec: string): ExtensionModelSelection | undefined => {
			const { model, thinkingLevel } = resolveRole(spec);
			return model ? { model, thinkingLevel } : undefined;
		},
		family: (model: Model<Api>): string =>
			model.identity.class === "unknown" ? model.provider.toLowerCase() : model.identity.class,
	};
}
