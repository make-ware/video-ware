/**
 * Shared stall state between the preview player's clock and its video
 * channels. Each TrackVideo reports whether it can currently render the frame
 * at the playhead; the player's playback loop freezes the shared clock while
 * any channel is stalled, so the playhead waits for buffers instead of
 * running ahead of what the players can show.
 *
 * State lives outside React (channels report from a pre-paint reconcile pass
 * and the clock reads it inside requestAnimationFrame); the subscribe/
 * getSnapshot pair exposes the aggregate to React via useSyncExternalStore
 * for the buffering indicator.
 */
export class PlaybackStallRegistry {
  private stalledKeys = new Set<string>();
  private listeners = new Set<() => void>();

  set(key: string, stalled: boolean): void {
    const before = this.stalledKeys.size > 0;
    if (stalled) {
      this.stalledKeys.add(key);
    } else {
      this.stalledKeys.delete(key);
    }
    if (before !== this.stalledKeys.size > 0) {
      for (const listener of this.listeners) listener();
    }
  }

  delete(key: string): void {
    this.set(key, false);
  }

  anyStalled(): boolean {
    return this.stalledKeys.size > 0;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): boolean => this.stalledKeys.size > 0;
}
