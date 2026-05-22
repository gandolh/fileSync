import type { ManifestEntry } from "./manifest.js";

export type IndexEntry = ManifestEntry & {
  /** "local" if this server holds the file, otherwise the peer name. */
  location: string;
};

export class IndexStore {
  private local: ManifestEntry[] = [];
  private remote = new Map<string, ManifestEntry[]>();

  setLocal(entries: ManifestEntry[]): void {
    this.local = entries;
  }

  setPeer(peerName: string, entries: ManifestEntry[]): void {
    this.remote.set(peerName, entries);
  }

  forgetPeer(peerName: string): void {
    this.remote.delete(peerName);
  }

  /** Local files win over remote duplicates. Among remotes, first peer wins. */
  list(): IndexEntry[] {
    const seen = new Map<string, IndexEntry>();
    for (const f of this.local) {
      seen.set(f.name, { ...f, location: "local" });
    }
    for (const [peer, files] of this.remote) {
      for (const f of files) {
        if (seen.has(f.name)) continue;
        seen.set(f.name, { ...f, location: peer });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  locate(name: string): IndexEntry | undefined {
    return this.list().find((e) => e.name === name);
  }
}
