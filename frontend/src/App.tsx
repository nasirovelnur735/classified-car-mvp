import { useState, useCallback, Component, type ReactNode } from "react";
import { UploadScreen } from "./components/UploadScreen";
import { EditScreen } from "./components/EditScreen";
import type { AnalysisResponse } from "./types";
import "./App.css";

class EditScreenErrorBoundary extends Component<
  { children: ReactNode; onBack: () => void },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="app" style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
          <h2 style={{ color: "var(--fg, #e8e6e3)", marginBottom: "1rem" }}>Ошибка при отображении экрана редактирования</h2>
          <pre style={{ color: "var(--fg)", background: "var(--surface)", padding: "1rem", borderRadius: "8px", overflow: "auto", fontSize: "14px" }}>
            {this.state.error.message}
          </pre>
          <button type="button" onClick={this.props.onBack} style={{ marginTop: "1rem" }}>
            Вернуться к загрузке
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  const handleResult = useCallback((data: AnalysisResponse, uploadedFiles: File[]) => {
    setResult(data);
    setFiles(uploadedFiles);
  }, []);

  const handleBack = useCallback(() => {
    setResult(null);
    setFiles([]);
  }, []);

  return (
    <div className="app">
      {result == null ? (
        <UploadScreen onResult={handleResult} />
      ) : (
        <EditScreenErrorBoundary onBack={handleBack}>
          <EditScreen data={result} files={files} setFiles={setFiles} onBack={handleBack} />
        </EditScreenErrorBoundary>
      )}
    </div>
  );
}

export default App;
