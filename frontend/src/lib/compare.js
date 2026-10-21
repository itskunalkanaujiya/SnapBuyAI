import { createContext, useContext } from "react";

// Products picked for "Compare": up to MAX_COMPARE, shared by every card.
export const MAX_COMPARE = 3;

export const CompareContext = createContext(null);

/** { isSelected(product), toggle(product), isFull } or null outside the app. */
export function useCompare() {
  return useContext(CompareContext);
}
