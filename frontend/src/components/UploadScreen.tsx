import { useCallback, useState } from "react";
import { analyzeImages } from "../api";
import type { AnalysisResponse } from "../types";
import "./UploadScreen.css";

type Props = {
  onResult: (data: AnalysisResponse, files: File[]) => void;
};

export function UploadScreen({ onResult }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    const images = list.filter((f) => f.type.startsWith("image/"));
    setFiles(images);
    setError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const list = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => (list.length ? [...prev, ...list] : prev));
    setError(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleSubmit = useCallback(async () => {
    if (!files.length) {
      setError("Загрузите хотя бы одно фото");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await analyzeImages(files);
      onResult(data, files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка анализа");
    } finally {
      setLoading(false);
    }
  }, [files, onResult]);

  return (
    <div className="upload-screen">
      <h1>Подготовка объявления о продаже авто</h1>
      <p className="subtitle">Загрузите фото автомобиля — ИИ заполнит параметры и описание. Все поля можно отредактировать.</p>

      <div
        className={`dropzone ${dragOver ? "drag-over" : ""} ${files.length ? "has-files" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="dropzone-input"
        />
        {files.length === 0 ? (
          <span>Перетащите фото сюда или нажмите для выбора</span>
        ) : (
          <span>Выбрано фото: {files.length}</span>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      <button
        type="button"
        className="btn btn-primary"
        onClick={handleSubmit}
        disabled={loading || !files.length}
      >
        {loading ? "Обработка…" : "Анализировать"}
      </button>

      {loading && (
        <div className="loading-hint">
          Идёт визуальная инспекция, классификация и оценка цены…
        </div>
      )}
    </div>
  );
}
