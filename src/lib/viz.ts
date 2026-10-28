import { useEffect, useState } from "react";
import { api } from "./api";
import type { Track } from "./types";

const cache = new Map<number, Promise<string | null>>();

export function artUrl(id: number): Promise<string | null> {
  let p = cache.get(id);
  if (!p) {
    p = api.getArt(id).catch(() => null);
    cache.set(id, p);
  }
  return p;
}

export function forgetArt(id: number) {
  cache.delete(id);
}

export function useArt(track: Track | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const id = track?.id;
  const has = track?.hasArt;
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (id !== undefined && has) void artUrl(id).then((u) => live && setUrl(u));
    return () => { live = false; };
  }, [id, has]);
  return url;
}
