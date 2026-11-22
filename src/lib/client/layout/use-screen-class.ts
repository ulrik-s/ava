"use client";

import { useMediaQuery } from "@/lib/client/use-media-query";
import {
  LAPTOP_MEDIA_QUERY, LARGE_MEDIA_QUERY, screenClassOf, type ScreenClass,
} from "@/lib/shared/layout/dock-layout";

/**
 * Aktuell skärmklass, läst med `matchMedia` (samma brytpunkter som CSS:en).
 * Vid serverrendering, och utan `matchMedia`, blir den `laptop`.
 */
export function useScreenClass(): ScreenClass {
  const atLeastLaptop = useMediaQuery(LAPTOP_MEDIA_QUERY, true);
  const atLeastLarge = useMediaQuery(LARGE_MEDIA_QUERY, false);
  return screenClassOf(atLeastLaptop, atLeastLarge);
}
