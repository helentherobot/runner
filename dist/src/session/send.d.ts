import type { ModelMessage } from 'ai';
import type { RunnerInstance } from '../recipes/run-recipe.js';
import type { SessionOptions, SendResult } from './types.js';
export declare function send(runner: RunnerInstance, options: SessionOptions, messages: ModelMessage[], message: string): Promise<SendResult>;
//# sourceMappingURL=send.d.ts.map