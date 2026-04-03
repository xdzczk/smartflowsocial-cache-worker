import { z } from 'zod';

import { isValidRequestType } from './request-types';

export const postBodySchema = z
	.object({
		requestType: z
			.string({ error: 'requestType is required' })
			.min(1, { error: 'requestType is required' }),
		params: z.record(z.string(), z.unknown()).optional(),
	})
	.strict()
	.superRefine((val, ctx) => {
		if (!isValidRequestType(val.requestType)) {
			ctx.addIssue({
				code: 'custom',
				message: `Invalid request type: ${val.requestType}`,
				path: ['requestType'],
			});
		}
	});

export type PostBody = z.infer<typeof postBodySchema>;
