import { useCallback, useEffect, useState, type FormEvent } from "react";

type IndexEntry = {
  name: string;
  size: number;
  mtime: number;
  contentType: string;
  location: string;
};

type IndexResponse = { name: string; files: IndexEntry[] };
type UploadResult = { saved: { filename: string; bytes: number }[] };

function fileUrl(name: string): string {
  return `/api/files/${encodeURIComponent(name)}`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function App() {
  const [index, setIndex] = useState<IndexResponse | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [status, setStatus] = useState<string>("");
  const [preview, setPreview] = useState<IndexEntry | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/index");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setIndex((await res.json()) as IndexResponse);
    } catch (err) {
      setStatus(`Index failed: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!files || files.length === 0) {
      setStatus("Pick a file first.");
      return;
    }
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);

    setStatus("Uploading…");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as UploadResult;
      setStatus(`Uploaded ${data.saved.length} file(s).`);
      void refresh();
    } catch (err) {
      setStatus(`Failed: ${(err as Error).message}`);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 960 }}>
      <h1>fileSync {index ? <small style={{ color: "#888" }}>@ {index.name}</small> : null}</h1>

      <form onSubmit={onUpload} style={{ marginBottom: 24 }}>
        <input type="file" multiple onChange={(e) => setFiles(e.target.files)} />
        <button type="submit" style={{ marginLeft: 8 }}>Upload</button>
        <button type="button" onClick={() => void refresh()} style={{ marginLeft: 8 }}>
          Refresh
        </button>
      </form>
      {status && <p>{status}</p>}

      <h2>Virtual index</h2>
      {!index ? (
        <p>Loading…</p>
      ) : index.files.length === 0 ? (
        <p>No files yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: 6 }}>Name</th>
              <th style={{ padding: 6 }}>Location</th>
              <th style={{ padding: 6 }}>Size</th>
              <th style={{ padding: 6 }}>Type</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {index.files.map((f) => (
              <tr key={f.name} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: 6, fontFamily: "monospace" }}>{f.name}</td>
                <td style={{ padding: 6 }}>
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: f.location === "local" ? "#e0f2e9" : "#eef2ff",
                      fontSize: 12,
                    }}
                  >
                    {f.location}
                  </span>
                </td>
                <td style={{ padding: 6 }}>{fmtBytes(f.size)}</td>
                <td style={{ padding: 6, color: "#666" }}>{f.contentType}</td>
                <td style={{ padding: 6 }}>
                  <button type="button" onClick={() => setPreview(f)}>Open</button>
                  <a
                    href={fileUrl(f.name)}
                    style={{ marginLeft: 8 }}
                    download={f.name}
                  >
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {preview && (
        <section style={{ marginTop: 24 }}>
          <h3>
            {preview.name}{" "}
            <button type="button" onClick={() => setPreview(null)} style={{ marginLeft: 8 }}>
              Close
            </button>
          </h3>
          {preview.contentType.startsWith("image/") ? (
            <img src={fileUrl(preview.name)} alt={preview.name} style={{ maxWidth: "100%" }} />
          ) : preview.contentType.startsWith("video/") ? (
            <video src={fileUrl(preview.name)} controls style={{ maxWidth: "100%" }} />
          ) : (
            <p>
              No inline preview for <code>{preview.contentType}</code>.{" "}
              <a href={fileUrl(preview.name)}>Open raw</a>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
