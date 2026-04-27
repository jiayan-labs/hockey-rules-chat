const fs = require("fs");
const path = require("path");

function splitIntoChunks(pages, maxChars = 1800) {
  const chunks = [];

  for (const page of pages) {
    const text = page.text || "";

    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push({
        page: page.page,
        fileName: page.fileName,
        text: text.slice(i, i + maxChars),
      });
    }
  }

  return chunks;
}

async function main() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const pdfPath = path.join(
    __dirname,
    "../public/fih-rules-of-hockey-2026-final.pdf"
  );

  const outputPath = path.join(
    __dirname,
    "../public/default-chunks.json"
  );

  const data = new Uint8Array(fs.readFileSync(pdfPath));

  const pdf = await pdfjsLib.getDocument({
    data,
    disableWorker: true,
  }).promise;

  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const text = content.items
      .map((item) => item.str)
      .join(" ")
      .trim();

    pages.push({
      page: pageNum,
      fileName: "fih-rules-of-hockey-2026-final.pdf",
      text,
    });

    console.log(`Parsed page ${pageNum}/${pdf.numPages}`);
  }

  const chunks = splitIntoChunks(pages);

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        fileName: "fih-rules-of-hockey-2026-final.pdf",
        pages: pdf.numPages,
        chunkCount: chunks.length,
        parsedPages: pages,
        chunks,
      },
      null,
      2
    )
  );

  console.log(`Done. Wrote ${chunks.length} chunks to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});