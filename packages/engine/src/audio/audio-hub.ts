/**
 * The page's one AudioContext. Browsers create it suspended and only let a user gesture resume
 * it, so the web shell calls `unlock()` from the loading screen's "Enter" click. Sound systems
 * (footsteps, ambience) take `context` once they exist.
 */
export class AudioHub {
  #context: AudioContext | undefined;

  get context(): AudioContext | undefined {
    return this.#context;
  }

  /** Creates or resumes the context. Resolves false when audio is unavailable or still blocked. */
  async unlock(): Promise<boolean> {
    if (typeof AudioContext === 'undefined') return false;
    this.#context ??= new AudioContext();
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
    if (context && context.state !== 'closed') {
      context.close().catch((error: unknown) => console.warn('Audio close failed', error));
    }
  }
}
