export type PrimalMockWsScenario =
	| 'success'
	| 'notice_error'
	| 'eose_only'
	| 'binary_frame'
	| 'invalid_json_message'
	| 'json_object_message'
	| 'connect_never';

/**
 * Test double for outbound Primal WebSocket (global `WebSocket` in unit/integration tests).
 */
export class MockPrimalWebSocket {
	static scenario: PrimalMockWsScenario = 'success';

	/** When set, non-undefined return overrides {@link scenario} for that URL. */
	static scenarioByUrl: ((url: string) => PrimalMockWsScenario | undefined) | null = null;

	/** Raw strings passed to `send()` (Primal wire JSON), most recent last. */
	static recordedSends: string[] = [];

	static instances: MockPrimalWebSocket[] = [];
	readonly url: string;
	onopen: (() => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;

	constructor(url: string | URL) {
		this.url = typeof url === 'string' ? url : url.toString();
		MockPrimalWebSocket.instances.push(this);
		queueMicrotask(() => {
			if (this.effectiveScenario() === 'connect_never') {
				return;
			}
			this.onopen?.();
		});
	}

	private effectiveScenario(): PrimalMockWsScenario {
		const mapped = MockPrimalWebSocket.scenarioByUrl?.(this.url);
		return mapped ?? MockPrimalWebSocket.scenario;
	}

	send(data: string): void {
		MockPrimalWebSocket.recordedSends.push(data);
		queueMicrotask(() => {
			const scenario = this.effectiveScenario();
			if (scenario === 'binary_frame') {
				this.onmessage?.({ data: new Uint8Array([1, 2, 3]) } as MessageEvent);
				return;
			}
			if (scenario === 'notice_error') {
				this.onmessage?.({ data: JSON.stringify(['NOTICE', 'sub', 'error']) } as MessageEvent);
				return;
			}
			if (scenario === 'eose_only') {
				this.onmessage?.({ data: JSON.stringify(['EOSE', 'sub']) } as MessageEvent);
				return;
			}
			if (scenario === 'invalid_json_message') {
				this.onmessage?.({ data: '{ not json' } as MessageEvent);
				return;
			}
			if (scenario === 'json_object_message') {
				this.onmessage?.({ data: JSON.stringify({ not: 'array' }) } as MessageEvent);
				return;
			}

			const messages: unknown[][] = [
				['EVENT', 'sub', { id: 'mock-event' }],
				['EOSE', 'sub'],
			];
			for (const m of messages) {
				this.onmessage?.({ data: JSON.stringify(m) } as MessageEvent);
			}
		});
	}

	close(): void {
		/* no-op */
	}

	addEventListener(type: string, listener: unknown): void {
		if (typeof listener !== 'function') return;
		if (type === 'open') this.onopen = listener as () => void;
		if (type === 'message') this.onmessage = listener as (e: MessageEvent) => void;
		if (type === 'error') this.onerror = listener as () => void;
		if (type === 'close') this.onclose = listener as () => void;
	}
}
