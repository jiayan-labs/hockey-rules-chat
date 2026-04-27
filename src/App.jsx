import React, { useMemo, useRef, useEffect, useState } from "react";
import { Upload, Send, Search, BookOpen, Loader2, AlertCircle, FileText, MessageSquare, Info } from "lucide-react";
import "./App.css";
import stickLogo from "./assets/stick-logo.svg";


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
        id: `${page.fileName || "file"}-${page.page}-${chunks.length}`,
        fileName: page.fileName || "Uploaded PDF",
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
    .map((m) => `• ${m.fileName}, page ${m.page}: ${m.text.length > 420 ? m.text.slice(0, 420) + "…" : m.text}`)
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
        "After uploading the rules, ask a question about penalties, scoring, aerial balls or anything else.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const fileInputRef = useRef(null);
  const hasLoadedDefault = useRef(false);

  const chunks = useMemo(() => splitIntoChunks(pages), [pages]);
  const ready = chunks.length > 0;

  useEffect(() => {
    if (hasLoadedDefault.current) return;
    hasLoadedDefault.current = true;

    async function loadDefaultPdf() {
      try {
        const res = await fetch("/fih-Rules-of-hockey-2026-final.pdf");
        const blob = await res.blob();

        const file = new File(
          [blob],
          "fih-Rules-of-hockey-2026-final.pdf",
          { type: "application/pdf" }
        );

        await parsePdf(file); // reuse your existing function
      } catch (err) {
        console.error("Failed to load default PDF", err);
      }
    }

    loadDefaultPdf();
  }, []);

  async function parsePdf(file) {
    setError("");
    setIsParsing(true);
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
        parsedPages.push({ page: pageNum, text, fileName: file.name });
      }

      //setPages((prev) => [...prev, ...parsedPages]);
      setPages(parsedPages); //replaced above for default PDF loading on start

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
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (e) {
      console.error(e);
      setError("I could not parse that PDF. Try a text-based PDF rather than a scanned image PDF.");
    } finally {
      setIsParsing(false);
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q) return;

    if (!ready) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: q, timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
        { role: "assistant", content: "Upload the PDF first so I can search the rules.", timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
      ]);
      setQuestion("");
      return;
    }

    // call OpenAI API with question and retrieved matches, then update messages with the answer
    const matches = retrieve(q, chunks);

    setMessages((prev) => [
      ...prev,
      { role: "user", content: q, timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
      //{ role: "assistant", content: buildAnswer(q, matches), timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
    ]);

    // Call backend instead of buildAnswer
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, something went wrong calling OpenAI.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    }

    setQuestion("");
  }

  const examples = [
    "When is a penalty corner awarded?",
    "Can a player use their foot?",
    "What is dangerous play?",
    "When is a green card shown?",
    "What is the role of the umpire?",
  ];

  return (
    <div className="page">
      <div className="banner"></div>
      <div className="shell">
        <header className="hero">
          <div className="clubMark" aria-hidden="true">
              <img src={stickLogo} alt="Hockey Stick Icon" className="logoImg" />
          </div>
          <div className="heroText">
            <div className="eyebrow">Game Rules Assistant Chatbot for Outdoor Field Hockey</div>
            <h1>Hockey Rules Assistant</h1>
            <p>Quick answers from the FIH Rules of Hockey</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => e.target.files?.[0] && parsePdf(e.target.files[0])}
          />
          <button className="uploadButton" onClick={() => fileInputRef.current?.click()}>
            {isParsing ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
            Upload PDF
          </button>
        </header>

        {error && <div className="error"><AlertCircle size={18} /> {error}</div>}

        <main className="layout">
          <section className="chatCard panel">
            <div className="sectionTitle"><MessageSquare size={22} /> <span>Chat</span></div>
            <p className="sectionSub">Ask a question about the rules of hockey.</p>

            <div className="messages">
              {!ready && messages.length === 1 && (
                <div className="emptyState">
                  <div className="emptyIcon">🏑</div>
                  <h2>No PDF loaded yet</h2>
                  <p>Upload the FIH Rules of Hockey PDF to get started.</p>
                  <button className="chooseButton" onClick={() => fileInputRef.current?.click()}>
                    <Upload size={18} /> Choose PDF File
                  </button>
                </div>
              )}

              {messages
                .filter((m) => ready || m.role !== "assistant" || !m.content.startsWith("Upload the FIH Rules of Hockey PDF"))
                .map((m, index) => (
                  <div key={index} className={`messageRow ${m.role}`}>
                    <div className={`message ${m.role}`}>
                      <div>{m.content}</div>
                      <div className="messageTime">{m.timestamp}</div>
                    </div>
                  </div>
                ))}
            </div>

            <div className="inputBar">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="Ask a question about the rules..."
              />
              <button className="send" onClick={ask}><Send size={18} /></button>
            </div>
          </section>

          <aside className="sideCard panel">
            <div className="sectionTitle"><FileText size={22} /> <span>Uploaded Files</span></div>
            {uploadedFiles.length === 0 ? (
              <div className="uploadEmptyBox">No files uploaded yet.</div>
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

            <div className="sectionTitle examplesTitle"><Search size={20} /> <span>Try these</span></div>
            <div className="examples">
              {examples.map((example) => (
                <button key={example} className="example" onClick={() => setQuestion(example)}>
                  <Search size={16} /> {example}
                </button>
              ))}
            </div>
          </aside>
        </main>

        <div className="notice panel">
          <Info size={22} />
          <div>
            <strong>This assistant searches your uploaded FIH Rules of Hockey PDF and provides references to relevant sections.</strong>
            <p>For guidance only. Check the official rules and umpire decisions.</p>
          </div>
        </div>

        <footer className="footer">
          <span>Powered by JY Labs</span>
          <span>Unofficial Chatbot App for FIH Rules of Hockey</span>
        </footer>
      </div>
    </div>
  );
}
