import primalRequestTypes from './data/primal-request-types.json';

const noParams = primalRequestTypes.noParams as readonly string[];
const withParams = primalRequestTypes.withParams as readonly string[];

/** Primal cache request types that omit `params` in the wire message. */
export const NO_PARAMS_TYPES: ReadonlySet<string> = new Set(noParams);

const VALID_REQUEST_TYPES = new Set<string>([...noParams, ...withParams]);

export function isValidRequestType(requestType: string): boolean {
	return VALID_REQUEST_TYPES.has(requestType);
}
