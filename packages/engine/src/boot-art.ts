import type { AvatarStyleV2, EventBus, QualityTier } from '@shipfair/shared';
import { Art } from './art.ts';
import { GltfAvatar } from './avatars/gltf-avatar.ts';
import { StressScene } from './debug/stress.ts';
import type { Multiplayer } from './net/multiplayer.ts';
import type { PhysicsWorld } from './physics/world.ts';
import type { PlayerSystem } from './player/player-system.ts';
import type { Renderer } from './render/renderer.ts';
import type { City } from './world/city.ts';

/** Art arrives after `start()`; until then (or without it) placeholders are used. */
export interface ArtHost {
  art: Art | null;
  stress: StressScene | null;
  /** Resolves once art has loaded and the local avatar is swapped (null if art failed). */
  ready: Promise<Art | null>;
}

export interface ArtBoot {
  bus: EventBus;
  renderer: Renderer;
  physics: PhysicsWorld;
  player: PlayerSystem;
  /** The engine's runtime now: undefined once it has been disposed. */
  runtime: () => { city: City | null; multiplayer: Multiplayer } | undefined;
  tier: () => QualityTier;
  /** The local player's look now (setLocalPlayer may change it while art loads). */
  style: () => AvatarStyleV2;
}

/**
 * Loads built art in the background. The procedural avatar stays until a real body and its
 * clips are ready; any failure keeps the placeholders (each piece reports `asset:missing`).
 */
export async function loadArt(host: ArtHost, boot: ArtBoot): Promise<Art | null> {
  const { renderer, player } = boot;
  try {
    const art = await Art.load(boot.bus, renderer.renderer);
    const runtime = boot.runtime();
    if (!runtime) {
      art.dispose();
      return null;
    }
    host.art = art;
    runtime.city?.attachArt(art);
    runtime.multiplayer.attachArt(art);
    host.stress = new StressScene(
      art,
      renderer.scene,
      boot.physics,
      player.camera.camera.position,
      boot.tier,
    );
    const factory = art.factory;
    const style = boot.style();
    if (factory && art.canBuildCharacters(`body_${style.body}`)) {
      const avatar = await GltfAvatar.create(factory, art.animations, style, 0);
      // After dispose the art (and so this avatar's geometry) is already released.
      if (!boot.runtime()) avatar.dispose();
      else {
        player.setAvatar(avatar);
        // setLocalPlayer may have run while the character was building.
        if (boot.style() !== style) avatar.setStyle(boot.style());
      }
    }
    return art;
  } catch (error) {
    console.error('Art failed to load; the game keeps its placeholders.', error);
    return null;
  }
}
