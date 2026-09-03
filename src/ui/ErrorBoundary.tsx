import { Component, type ErrorInfo, type ReactNode } from 'react';
import { resetPlans } from '../persistence/planStore';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches rendering/runtime errors anywhere below it so one bad saved-plan
 * record (or any other unexpected data shape) blanks a single screen instead
 * of the whole application. See REVIEW_RECOMMENDATIONS item 1.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Prototype-only diagnostics; no external error reporting is wired up.
    console.error('Workforce Planner crashed:', error, info.componentStack);
  }

  private resetAndReload = () => {
    resetPlans();
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <span>PROTOTYPE — SAMPLE DATA ONLY</span>
          <h1>Something went wrong</h1>
          <p>
            The workforce planner hit an unexpected error, most likely from a
            saved plan created by an earlier build of this prototype.
          </p>
          <p className="error-boundary-detail">{this.state.error.message}</p>
          <button className="primary" onClick={this.resetAndReload}>
            RESET PROTOTYPE DATA &amp; RELOAD
          </button>
        </div>
      </div>
    );
  }
}
