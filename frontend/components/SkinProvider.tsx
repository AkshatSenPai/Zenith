"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_SKIN, SKIN_STORAGE_KEY, type SkinId, isSkinId } from "../lib/skins";

const Ctx = createContext<{ skin: SkinId; setSkin: (id: SkinId) => void }>({
  skin: DEFAULT_SKIN,
  setSkin: () => {},
});

export function SkinProvider({ children }: { children: React.ReactNode }) {
  // Start at the default; the inline no-flash script in <head> has already set
  // document.documentElement.dataset.skin from localStorage before paint, so there is no
  // color flash. On mount we sync React state to that persisted value.
  const [skin, setSkinState] = useState<SkinId>(DEFAULT_SKIN);

  useEffect(() => {
    const saved = localStorage.getItem(SKIN_STORAGE_KEY);
    if (isSkinId(saved)) setSkinState(saved);
  }, []);

  const setSkin = useCallback((id: SkinId) => {
    setSkinState(id);
    localStorage.setItem(SKIN_STORAGE_KEY, id);
    document.documentElement.dataset.skin = id;
  }, []);

  // Keep the attribute in sync whenever state changes (covers the mount sync above).
  useEffect(() => {
    document.documentElement.dataset.skin = skin;
  }, [skin]);

  return <Ctx.Provider value={{ skin, setSkin }}>{children}</Ctx.Provider>;
}

export const useSkin = () => useContext(Ctx);
