/**
 * The page's one AudioContext. Browsers create it suspended and only let a user gesture resume
 * it, so the web shell calls `unlock()` from the loading screen's "Enter" click. Sound systems
 * (footsteps, ambience) take `context` once they exist and connect to `output`, the master gain
 * that the settings menu's volume controls.
 */
export class AudioHub {
  #context: AudioContext | undefined;
  #output: GainNode | undefined;
  #volume = 1;

  get context(): AudioContext | undefined {
    return this.#context;
  }

  /** Where sounds connect (the master volume). Undefined until `unlock()`. */
  get output(): GainNode | undefined {
    return this.#output;
  }

  get volume(): number {
    return this.#volume;
  }

  /** 0 (silent) to 1. Kept until the context exists. */
  setVolume(volume: number): void {
    this.#volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    if (this.#output) this.#output.gain.value = this.#volume;
  }

  /** Creates or resumes the context. Resolves false when audio is unavailable or still blocked. */
  async unlock(): Promise<boolean> {
    if (typeof AudioContext === 'undefined') return false;
    if (!this.#context) {
      this.#context = new AudioContext();
      this.#output = this.#context.createGain();
      this.#output.gain.value = this.#volume;
      this.#output.connect(this.#context.destination);
    }
    if (this.#context.state === 'suspended') {
      try {
        await this.#context.resume();
      } catch (error) {
        console.warn('Audio stayed locked', error);
      }
    }
    return this.#context.state === 'running';
  }

  dispose(): void {
    const context = this.#context;
    this.#context = undefined;
    this.#output = undefined;
    if (context && context.state !== 'closed') {
      context.close().catch((error: unknown) => console.warn('Audio close failed', error));
    }
  }
}
