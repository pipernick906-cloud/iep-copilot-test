import * as webllm from "@mlc-ai/web-llm";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

// Set up local PDF worker bundled by Vite/Tauri
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

let engine = null;
let psychText = "";
let iepText = "";

const SELECTED_MODEL = "Llama-3.2-3B-Instruct-q4f32_1-MLC";

// 1. Initialize WebLLM Engine
document.getElementById("init-ai-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("model-status");
  const btn = document.getElementById("init-ai-btn");
  btn.disabled = true;
  statusEl.innerText = "Loading model weights...";

  try {
    engine = await webllm.CreateMLCEngine(SELECTED_MODEL, {
      initProgressCallback: (report) => {
        statusEl.innerText = report.text;
      },
    });
    statusEl.innerText = "AI Engine: Ready (Offline)";
    statusEl.className = "text-xs font-mono text-emerald-400";
    btn.innerText = "Loaded";
  } catch (err) {
    statusEl.innerText = `Error: ${err.message}`;
    statusEl.className = "text-xs font-mono text-rose-400";
    btn.disabled = false;
  }
});

// 2. Local PDF Parser + Basic PII Scrubber
async function parsePDF(file, statusElementId) {
  const statusEl = document.getElementById(statusElementId);
  statusEl.innerText = `Reading ${file.name}...`;

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let extracted = "";

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    extracted += `\n[Page ${i}] ` + content.items.map((item) => item.str).join(" ");
  }

  // Scrub common student IDs, SSNs, Phone Numbers, and DOB formats locally
  const scrubbed = extracted
    .replace(/\b\d{5,10}\b/g, "[ID_REDACTED]")
    .replace(/\b\d{2}\/\d{2}\/\d{2,4}\b/g, "[DOB_REDACTED]")
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[PHONE_REDACTED]");

  statusEl.innerText = `Parsed ${pdfDoc.numPages} pages (PII Scrubbed)`;
  statusEl.className = "text-[11px] font-mono text-emerald-400 mt-1";
  return scrubbed;
}

document.getElementById("psych-upload").addEventListener("change", async (e) => {
  if (e.target.files[0]) psychText = await parsePDF(e.target.files[0], "psych-status");
});

document.getElementById("iep-upload").addEventListener("change", async (e) => {
  if (e.target.files[0]) iepText = await parsePDF(e.target.files[0], "iep-status");
});

// 3. Run Local Inference
document.getElementById("run-btn").addEventListener("click", async () => {
  const outputEl = document.getElementById("ai-output");
  const task = document.getElementById("task-select").value;

  if (!engine) {
    outputEl.innerText = "⚠️ Please click 'Initialize Local AI' in the top bar first.";
    return;
  }

  const taskPrompts = {
    audit: "Compare the Psych Evaluation against the Draft IEP. Flag any baseline test score discrepancies, missing accommodations, or compliance mismatches clearly.",
    goals: "Based on the Present Levels (PLAAFP) and evaluation data provided, draft 3 legally defensible, measurable SMART annual goals with clear baseline and mastery criteria.",
    jargon: "Rewrite the clinical and psychological evaluation findings into warm, empathetic, parent-friendly plain language while maintaining accuracy.",
  };

  outputEl.innerText = "Analyzing documents locally on your GPU...\n\n";

  try {
    const chunks = await engine.chat.completions.create({
      messages: [
        { role: "system", content: `You are an expert Special Education Compliance Assistant. ${taskPrompts[task]}` },
        { role: "user", content: `PSYCH EVAL:\n${psychText || "None"}\n\nDRAFT IEP:\n${iepText || "None"}` },
      ],
      temperature: 0.2,
      stream: true,
    });

    outputEl.innerText = "";
    for await (const chunk of chunks) {
      outputEl.innerText += chunk.choices[0]?.delta?.content || "";
    }
  } catch (err) {
    outputEl.innerText = `Execution Error: ${err.message}`;
  }
});