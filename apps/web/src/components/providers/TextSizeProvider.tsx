"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type TextSize = "normal" | "large" | "larger";
const TEXT_SIZE_KEY = "textSize";

interface TextSizeContextValue {
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
}

const TextSizeContext = createContext<TextSizeContextValue>({
  textSize: "normal",
  setTextSize: () => {},
});

function readInitialTextSize(): TextSize {
  if (typeof window === "undefined") return "normal";
  try {
    const stored = localStorage.getItem(TEXT_SIZE_KEY);
    return stored === "large" || stored === "larger" ? stored : "normal";
  } catch {
    return "normal";
  }
}

function applyTextSize(size: TextSize): void {
  document.documentElement.setAttribute("data-text-size", size);
}

export function TextSizeProvider({ children }: { children: ReactNode }) {
  const [textSize, setTextSizeState] = useState<TextSize>(readInitialTextSize);

  useEffect(() => {
    applyTextSize(textSize);
  }, [textSize]);

  const setTextSize = useCallback((next: TextSize) => {
    try {
      localStorage.setItem(TEXT_SIZE_KEY, next);
    } catch {
      // Non-fatal.
    }
    setTextSizeState(next);
    applyTextSize(next);
  }, []);

  return (
    <TextSizeContext.Provider value={{ textSize, setTextSize }}>
      {children}
    </TextSizeContext.Provider>
  );
}

export function useTextSize(): TextSizeContextValue {
  return useContext(TextSizeContext);
}
