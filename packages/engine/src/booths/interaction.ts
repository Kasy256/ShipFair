import {
  BOOTH_FOCUS_RADIUS_M,
  type CityLayout,
  districtAt,
  type EventBus,
  nearestBooth,
} from '@shipfair/shared';
import { KIOSK_RADIUS_M } from '../config.ts';

export interface InteractionHost {
  readonly layout: CityLayout;
  /** False for removed booths (their lots stay in the layout as tombstones). */
  isLive(boothId: string): boolean;
  readonly kiosk: { readonly x: number; readonly z: number };
}

/**
 * Booth focus and opening (ARCHITECTURE.md §3). Every frame it finds the nearest booth anchor
 * within BOOTH_FOCUS_RADIUS_M (the shared spatial grid; allocation-free) and emits `booth:focus`
 * when that changes. `interact()` (E, the touch button, a click while pointer-locked, gamepad X)
 * opens the focused booth, or the submit form at the plaza kiosk. It also emits `zone:entered`
 * when the player crosses into a district or back onto the plaza.
 */
export class BoothInteraction {
  readonly #bus: EventBus;
  readonly #host: InteractionHost;
  readonly #focusPayload: { boothId: string | null } = { boothId: null };
  readonly #zonePayload: { districtId: number | null } = { districtId: null };
  readonly #openPayload = { boothId: '' };
  #focused: string | null = null;
  #zone: number | null | undefined;
  #isAtKiosk = false;
  /** Called with the new zone (null: the plaza) when it changes. */
  onZone: ((districtId: number | null) => void) | undefined;

  constructor(bus: EventBus, host: InteractionHost) {
    this.#bus = bus;
    this.#host = host;
  }

  get focused(): string | null {
    return this.#focused;
  }

  get zone(): number | null {
    return this.#zone ?? null;
  }

  get isAtKiosk(): boolean {
    return this.#isAtKiosk;
  }

  update(x: number, z: number): void {
    const layout = this.#host.layout;
    const anchor = nearestBooth(layout, x, z, BOOTH_FOCUS_RADIUS_M);
    const id = anchor && this.#host.isLive(anchor.boothId) ? anchor.boothId : null;
    if (id !== this.#focused) {
      this.#focused = id;
      this.#focusPayload.boothId = id;
      this.#bus.emit('booth:focus', this.#focusPayload);
    }
    const k = this.#host.kiosk;
    const dx = x - k.x;
    const dz = z - k.z;
    this.#isAtKiosk = dx * dx + dz * dz <= KIOSK_RADIUS_M * KIOSK_RADIUS_M;
    const zone = districtAt(layout, x, z)?.id ?? null;
    if (zone !== this.#zone) {
      this.#zone = zone;
      this.#zonePayload.districtId = zone;
      this.#bus.emit('zone:entered', this.#zonePayload);
      this.onZone?.(zone);
    }
  }

  /** Opens what the player is at: the focused booth, else the kiosk. Returns what happened. */
  interact(): 'booth' | 'kiosk' | null {
    if (this.#focused) {
      this.#openPayload.boothId = this.#focused;
      this.#bus.emit('booth:open', this.#openPayload);
      return 'booth';
    }
    if (this.#isAtKiosk) {
      this.#bus.emit('ui:open-submit');
      return 'kiosk';
    }
    return null;
  }

  /** Clears focus (e.g. the city is going away). */
  reset(): void {
    if (this.#focused === null) return;
    this.#focused = null;
    this.#focusPayload.boothId = null;
    this.#bus.emit('booth:focus', this.#focusPayload);
  }
}
