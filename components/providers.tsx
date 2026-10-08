"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="medassist-theme"
    >
      {children}
      <Toaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{
          classNames: {
            toast: "glass-strong !rounded-2xl !border !text-ink",
            description: "!text-muted",
            actionButton: "!bg-brand !text-white",
            cancelButton: "!bg-muted/20 !text-ink",
          },
        }}
      />
    </NextThemesProvider>
  );
}