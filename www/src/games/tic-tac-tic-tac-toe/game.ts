import type { ServerMessage, TttState } from '../../../../shared/protocol';
export class TttGame { state: TttState | null = null; apply(msg: ServerMessage): void { if (msg.t === 'tttt') this.state = msg.d; } }
