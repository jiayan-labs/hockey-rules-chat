import React, { useMemo, useRef, useState } from "react";
import { Upload, Send, Search, BookOpen, Loader2, AlertCircle } from "lucide-react";
import "./App.css";

function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  const stop = new Set([
    "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "by", "is", "are", "be", "must", "may", "from", "at", "it", "this", "that", "when", "if", "as", "not", "player", "players", "ball", "team", "teams"
  ]);
  return normalise(text)
    .split(" ")
    .filter((w) => w.length > 2 && !stop.has(w));
}

function splitIntoChunks(pages) {
  const chunks = [];
  for (const page of pages) {
    const blocks = page.text
      .split(/(?=\n?\d{1,2}\.\d\s)|\n{2,}/g)
      .map((x) => x.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    for (const block of blocks) {
      if (block.length < 40) continue;
      chunks.push({
        id: `${page.page}-${chunks.length}`,
        page: page.page,
        text: block,
        tokens: tokenize(block),
      });
    }
  }
  return chunks;
}

function scoreChunk(queryTokens, chunk) {
  if (!queryTokens.length) return 0;
  const counts = new Map();
  for (const token of chunk.tokens) counts.set(token, (counts.get(token) || 0) + 1);
  let score = 0;
  for (const token of queryTokens) {
    if (counts.has(token)) score += 3 + Math.log(1 + counts.get(token));
  }
  return score / Math.sqrt(chunk.tokens.length + 1);
}

function retrieve(question, chunks, limit = 4) {
  const qTokens = tokenize(question);
  return chunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(qTokens, chunk) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function buildAnswer(question, matches) {
  if (!matches.length) {
    return "I could not find a confident match in the uploaded rules. Try using more specific words, for example penalty corner, aerial ball, foot, goalkeeper, or free hit.";
  }

  const bullets = matches
    .slice(0, 3)
    .map((m) => `• Page ${m.page}: ${m.text.length > 420 ? m.text.slice(0, 420) + "…" : m.text}`)
    .join("\n\n");

  return `Based on the closest rule text I found for “${question}”:\n\n${bullets}`;
}

export default function App() {
  const [pages, setPages] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Upload the field hockey rules PDF, then ask things like: “When is a penalty corner awarded?” or “Can a player use their foot?”",
    },
  ]);
  const fileInputRef = useRef(null);

  const chunks = useMemo(() => splitIntoChunks(pages), [pages]);
  const ready = chunks.length > 0;

  async function parsePdf(file) {
    setError("");
    setIsParsing(true);
    // This prototype keeps uploaded PDFs in browser memory only.
    // Each upload is parsed and added to the searchable index.
    const uploadedAt = new Date().toLocaleTimeString();

    try {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

      const buffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      const parsedPages = [];

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const text = content.items.map((item) => item.str).join(" ");
        parsedPages.push({ page: pageNum, text });
      }

      setPages((prev) => [...prev, ...parsedPages.map((page) => ({ ...page, fileName: file.name }))]);
      const count = splitIntoChunks(parsedPages).length;
      setUploadedFiles((prev) => [
        ...prev,
        {
          name: file.name,
          pages: pdf.numPages,
          chunks: count,
          uploadedAt,
        },
      ]);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Loaded ${file.name}: ${pdf.numPages} pages and ${count} searchable chunks. Ask me a rules question.`,
        },
      ]);
    } catch (e) {
      console.error(e);
      setError("I could not parse that PDF. Try a text-based PDF rather than a scanned image PDF.");
    } finally {
      setIsParsing(false);
    }
  }

  function ask() {
    const q = question.trim();
    if (!q) return;

    if (!ready) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: q },
        { role: "assistant", content: "Upload the PDF first so I can search the rules." },
      ]);
      setQuestion("");
      return;
    }

    const matches = retrieve(q, chunks);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: q },
      { role: "assistant", content: buildAnswer(q, matches) },
    ]);
    setQuestion("");
  }

  const examples = [
    "When is a penalty corner awarded?",
    "Can a player use their foot?",
    "What is the 5 metre rule for aerial balls?",
    "Can defenders self-pass while wearing penalty corner protection?",
    "When is a goal scored?",
  ];

  return (
    <div className="page">
      <div className="container">
        <header className="header">
          <div>
            <div className="badge"><BookOpen size={16} /> Field Hockey Rules Assistant</div>
            <h1>Ask the hockey rules PDF</h1>
            <p>A browser chatbot prototype that searches your uploaded rules PDF and gives page references.</p>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => e.target.files?.[0] && parsePdf(e.target.files[0])}
            />
            <button className="primary" onClick={() => fileInputRef.current?.click()}>
              {isParsing ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
              Upload PDF
            </button>
          </div>
        </header>

        {error && <div className="error"><AlertCircle size={18} /> {error}</div>}

        <main className="layout">
          <section className="chatCard">
            <div className="chatTop">
              <strong>Chat</strong>
              <span>{uploadedFiles.length ? `${uploadedFiles.length} file(s) • ${chunks.length} chunks indexed` : "No PDF loaded yet"}</span>
            </div>

            <div className="messages">
              {messages.map((m, index) => (
                <div key={index} className={`messageRow ${m.role}`}>
                  <div className={`message ${m.role}`}>{m.content}</div>
                </div>
              ))}
            </div>

            <div className="inputBar">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="Ask: When is a penalty corner awarded?"
              />
              <button className="send" onClick={ask}><Send size={18} /></button>
            </div>
          </section>

          <aside className="sideCard">
            <div className="sideTitle"><BookOpen size={16} /> Uploaded files</div>
            {uploadedFiles.length === 0 ? (
              <p className="emptyFiles">No files uploaded yet.</p>
            ) : (
              <div className="fileList">
                {uploadedFiles.map((file, index) => (
                  <div className="fileItem" key={`${file.name}-${index}`}>
                    <strong>{file.name}</strong>
                    <span>{file.pages} pages • {file.chunks} chunks • {file.uploadedAt}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="sideTitle examplesTitle"><Search size={16} /> Try these</div>
            {examples.map((example) => (
              <button key={example} className="example" onClick={() => setQuestion(example)}>
                {example}
              </button>
            ))}
          </aside>
        </main>
      </div>
    </div>
  );
}
