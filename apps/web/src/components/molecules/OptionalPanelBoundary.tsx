"use client";

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import styles from "./OptionalPanelBoundary.module.css";

interface OptionalPanelBoundaryProps {
  label: string;
  children: ReactNode;
  onClose?: () => void;
}

interface OptionalPanelBoundaryState {
  failed: boolean;
  attempt: number;
}

/** Keeps an optional lazy surface from replacing the critical workspace. */
export class OptionalPanelBoundary extends Component<
  OptionalPanelBoundaryProps,
  OptionalPanelBoundaryState
> {
  override state: OptionalPanelBoundaryState = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<OptionalPanelBoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The global monitoring boundary may capture sanitized runtime metadata;
    // this local boundary intentionally does not log private document content.
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <section className={styles.fallback} role="alert">
          <p>{this.props.label} could not be loaded. Your document is still available.</p>
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => this.setState((state) => ({
                failed: false,
                attempt: state.attempt + 1,
              }))}
            >
              Try again
            </button>
            {this.props.onClose ? (
              <button type="button" onClick={this.props.onClose}>Close</button>
            ) : null}
          </div>
        </section>
      );
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
