/** Application error with an HTTP status for the Worker `fetch` handler. */
export class WorkerHttpError extends Error {
	readonly status: number;
	readonly traceId: string;

	constructor(status: number, message: string, traceId: string) {
		super(message);
		this.name = 'WorkerHttpError';
		this.status = status;
		this.traceId = traceId;
	}
}
