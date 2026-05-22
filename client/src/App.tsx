import { useState, type FormEvent } from "react";

type UploadResult = { saved: { filename: string; bytes: number }[] };

export function App() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [status, setStatus] = useState<string>("");
  const [result, setResult] = useState<UploadResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!files || files.length === 0) {
      setStatus("Pick a file first.");
      return;
    }
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);

    setStatus("Uploading...");
    setResult(null);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as UploadResult;
      setResult(data);
      setStatus(`Uploaded ${data.saved.length} file(s).`);
    } catch (err) {
      setStatus(`Failed: ${(err as Error).message}`);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 640 }}>
      <h1>fileSync</h1>
      <form onSubmit={onSubmit}>
        <input
          type="file"
          multiple
          onChange={(e) => setFiles(e.target.files)}
        />
        <button type="submit" style={{ marginLeft: 8 }}>
          Upload
        </button>
      </form>
      <p>{status}</p>
      {result && (
        <ul>
          {result.saved.map((s) => (
            <li key={s.filename}>
              {s.filename} ({s.bytes} bytes)
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
