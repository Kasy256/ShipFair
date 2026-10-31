// The socket interface rooms program against (room-server.ts implements it over PartyServer).
// Kept free of PartyServer and Worker types so pure modules can depend on it.

/** One client socket. `state` is stored in the WebSocket attachment, so it survives hibernation. */
export interface RoomConnection<S> {
  readonly id: string;
  readonly state: S | null;
  readonly isOpen: boolean;
  setState(state: S): void;
  send(data: Uint8Array): void;
  close(code: number, reason: string): void;
}
