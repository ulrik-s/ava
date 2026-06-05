"use client";

/**
 * `RenderErrorBoundary` — fångar render-fel och visar dem inline
 * istället för att låta renderer-processen krascha. Används i
 * demo-builden för felsökning.
 */

import { Component, type ReactNode } from "react";

interface State { error: Error | null; componentStack: string | null }

export class RenderErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, componentStack: null };
  static getDerivedStateFromError(error: Error): State { return { error, componentStack: null }; }
  override componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[render-error]", error.message, "\nComponentStack:", info.componentStack);
    this.setState({ componentStack: info.componentStack });
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="m-4 p-4 bg-red-50 border-l-4 border-red-400 text-red-900 text-xs font-mono">
          <div className="font-bold mb-2">Render-fel</div>
          <div>{this.state.error.name}: {this.state.error.message}</div>
          <pre className="mt-2 whitespace-pre-wrap text-[10px] text-red-700">{this.state.error.stack?.slice(0, 1500)}</pre>
          {this.state.componentStack && (
            <>
              <div className="mt-3 font-bold">Component stack:</div>
              <pre className="mt-1 whitespace-pre-wrap text-[10px] text-red-700">{this.state.componentStack}</pre>
            </>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
