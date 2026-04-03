export type PrimalMockWsScenario = 'success' | 'notice_error' | 'eose_only' | 'binary_frame';

/**
 * Test double for outbound Primal WebSocket (global `WebSocket` in unit/integration tests).
 */
export class MockPrimalWebSocket {
	static scenario: PrimalMockWsScenario = 'success';

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
			this.onopen?.();
		});
	}

	send(_data: string): void {
		queueMicrotask(() => {
			const scenario = MockPrimalWebSocket.scenario;
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
