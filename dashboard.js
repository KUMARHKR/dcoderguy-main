// --- STATE MANAGEMENT ---
let queuedRecords = [];
let enrichedResults = [];
let isProcessing = false;
let isPaused = false;

// --- DOM ELEMENTS ---
const tabs = document.querySelectorAll('.nav-btn');
const tabViews = document.querySelectorAll('.tab-view');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseFilesBtn = document.getElementById('browseFilesBtn');
const fileList = document.getElementById('fileList');
const fileCountEl = document.getElementById('fileCount');
const totalInputRecordsEl = document.getElementById('totalInputRecords');

const openRouterApiKeyEl = document.getElementById('openRouterApiKey');
const openRouterModelEl = document.getElementById('openRouterModel');
const crawlLimitEl = document.getElementById('crawlLimit');
const delaySecEl = document.getElementById('delaySec');

const testApiBtn = document.getElementById('testApiBtn');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const startEnrichBtn = document.getElementById('startEnrichBtn');
const pauseEnrichBtn = document.getElementById('pauseEnrichBtn');
const stopEnrichBtn = document.getElementById('stopEnrichBtn');

const metricTotalEl = document.getElementById('metricTotal');
const metricProcessedEl = document.getElementById('metricProcessed');
const metricEmailsEl = document.getElementById('metricEmails');
const metricPhonesEl = document.getElementById('metricPhones');
const progressStatusEl = document.getElementById('progressStatus');
const progressBarEl = document.getElementById('progressBar');
const dataRowsEl = document.getElementById('dataRows');

// Load stored settings
chrome.storage.local.get(['openRouterApiKey', 'openRouterModel', 'crawlLimit', 'delaySec'], (res) => {
  if (res.openRouterApiKey) openRouterApiKeyEl.value = res.openRouterApiKey;
  if (res.openRouterModel) openRouterModelEl.value = res.openRouterModel;
  if (res.crawlLimit) crawlLimitEl.value = res.crawlLimit;
  if (res.delaySec) delaySecEl.value = res.delaySec;
});

saveConfigBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    openRouterApiKey: openRouterApiKeyEl.value.trim(),
    openRouterModel: openRouterModelEl.value,
    crawlLimit: parseInt(crawlLimitEl.value, 10),
    delaySec: parseFloat(delaySecEl.value)
  }, () => alert("Configuration saved!"));
});

testApiBtn.addEventListener('click', async () => {
  const key = openRouterApiKeyEl.value.trim();
  if (!key) return alert("Please enter an OpenRouter API Key.");
  testApiBtn.textContent = "Testing...";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: openRouterModelEl.value, messages: [{ role: "user", content: "Reply OK" }] })
    });
    if (res.ok) alert("✅ Connection Successful! AI Model ready.");
    else {
        const err = await res.json().catch(()=>({}));
        alert(`❌ API Error: ${err?.error?.message || res.status}`);
    }
  } catch (e) {
    alert("❌ Network error connecting to OpenRouter.");
  }
  testApiBtn.textContent = "Test AI Connection";
});

// --- TABS & UPLOAD ---
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tabViews.forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

dropzone.addEventListener('click', () => fileInput.click());
browseFilesBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

function parseCSV(text) {
  const lines = text.split(/\r\n|\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return [];
  const parseLine = (line) => {
    const values = []; let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && line[i+1] === '"') { cur += '"'; i++; } else { inQuote = !inQuote; }
      } else if (c === ',' && !inQuote) {
        values.push(cur.trim()); cur = '';
      } else { cur += c; }
    }
    values.push(cur.trim());
    return values;
  };
  const headers = parseLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]).map(c => c.replace(/^"|"$/g, '').trim());
    if (cols.length === headers.length || cols.length > 1) {
      const row = {}; headers.forEach((h, idx) => row[h] = cols[idx] || ""); records.push(row);
    }
  }
  return records;
}

function handleFiles(files) {
  fileList.innerHTML = ''; queuedRecords = []; let filesProcessed = 0;
  Array.from(files).forEach(file => {
    if (!file.name.endsWith('.csv')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseCSV(e.target.result);
      if (rows.length > 0 && !("Company Name" in rows[0])) {
         alert(`Error: Could not find "Company Name" column in ${file.name}. Found: ${Object.keys(rows[0]).join(', ')}`);
         return;
      }
      rows.forEach(r => r._sourceFile = file.name);
      queuedRecords.push(...rows);
      fileList.innerHTML += `<li>${file.name} - ${rows.length} records</li>`;
      filesProcessed++;
      if (filesProcessed === files.length) {
        fileCountEl.textContent = files.length; totalInputRecordsEl.textContent = queuedRecords.length; metricTotalEl.textContent = queuedRecords.length;
        renderInitialTable();
      }
    };
    reader.readAsText(file);
  });
}

function renderInitialTable() {
  dataRowsEl.innerHTML = '';
  queuedRecords.slice(0, 100).forEach((rec, idx) => {
    const tr = document.createElement('tr'); tr.id = `row-${idx}`;
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${rec["Company Name"] || "N/A"}</strong><br><small style="color:var(--muted);">${rec["CIN"] || ""}</small></td>
      <td class="col-type">-</td>
      <td class="col-web">-</td>
      <td class="col-emails">-</td>
      <td class="col-phones">-</td>
      <td class="col-lead">-</td>
      <td><span class="badge badge-pending">Queued</span></td>
    `;
    dataRowsEl.appendChild(tr);
  });
}

// --- BULLETPROOF MULTI-ENGINE SEARCH ---
async function searchWebEngines(query) {
  const searchEngines = [
    `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`,
    `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  ];

  let html = '';
  for (const url of searchEngines) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
      if (res.ok) { html = await res.text(); break; }
    } catch (e) { continue; }
  }

  if (!html) throw new Error("All search engines blocked the request.");

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const topUrls = [], linkedinUrls = [], snippets = [];

  // Extract Links
  doc.querySelectorAll('a').forEach(a => {
    let href = a.href || '';
    if (href.includes('/url?q=')) href = decodeURIComponent(href.split('/url?q=')[1].split('&')[0]);
    if (href.includes('RU=')) href = decodeURIComponent(href.split('RU=')[1].split('/R=')[0]);

    if (href.startsWith('http') && !href.includes('yahoo.com') && !href.includes('bing.com') && !href.includes('google.com')) {
      if (href.includes('linkedin.com/in/') || href.includes('linkedin.com/company/')) {
        if (!linkedinUrls.includes(href)) linkedinUrls.push(href);
      } else if (!href.includes('zaubacorp.com') && !href.includes('justdial.com')) {
        if (!topUrls.includes(href)) topUrls.push(href);
      }
    }
  });

  // Extract Snippets (removes masked emails)
  doc.querySelectorAll('p, div.compText, div.b_caption, span.aCOpRe').forEach(node => {
    let text = node.textContent.trim();
    text = text.replace(/[a-zA-Z0-9._-]+?\*{3,}@[a-zA-Z0-9.-]+/g, ''); // Strip masked emails
    if (text.length > 30 && !snippets.includes(text)) snippets.push(text);
  });

  return { topUrls: topUrls.slice(0, 5), linkedinUrls: linkedinUrls.slice(0, 5), snippets: snippets.slice(0, 8) };
}

// --- HTML CRAWLER & DEEP REGEX EXTRACTOR ---
async function crawlWebsites(urls, linkedinUrls) {
  const extractedEmails = new Set();
  const extractedPhones = new Set();
  const pageTexts = [];

  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,10})/gi;
  const phoneRegex = /(?:(?:\+|0{0,2})91[\s-]?)?[6789]\d{2}[\s-]?\d{3}[\s-]?\d{4}/g;

  // Add contact pages and linkedin urls to crawl list
  const urlsToCrawl = new Set([...urls, ...linkedinUrls]);
  if (urls[0]) {
      try {
          const baseUrl = new URL(urls[0]).origin;
          urlsToCrawl.add(`${baseUrl}/contact`);
      } catch(e) {}
  }

  for (const url of Array.from(urlsToCrawl).slice(0, parseInt(crawlLimitEl.value, 10) + 2)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const html = await res.text();
      
      const foundEmails = html.match(emailRegex) || [];
      foundEmails.forEach(e => {
        const clean = e.toLowerCase().trim();
        if (!clean.includes('***') && !clean.endsWith('.png') && !clean.endsWith('.jpg') && clean.length < 50) extractedEmails.add(clean);
      });

      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style, nav, footer, noscript, svg').forEach(el => el.remove());
      const bodyText = doc.body ? doc.body.textContent.replace(/\s+/g, ' ').trim() : '';

      const foundPhones = bodyText.match(phoneRegex) || [];
      foundPhones.forEach(p => {
        const clean = p.replace(/[^\d+]/g, '').trim();
        if (clean.length >= 8 && clean.length <= 15) extractedPhones.add(clean);
      });

      if (bodyText.length > 100) pageTexts.push(`Source [${url}]:\n${bodyText.substring(0, 1000)}`);
    } catch (e) { /* Ignore timeouts */ }
  }

  return { emails: Array.from(extractedEmails), phones: Array.from(extractedPhones), combinedText: pageTexts.join('\n\n') };
}

// --- AI SYNTHESIS WITH CRASH PROTECTION ---
async function synthesizeWithAI(company, searchData, crawledData, apiKey, model) {
  if (!apiKey) throw new Error("API Key Missing");

  const prompt = `
Analyze this company:
Name: "${company["Company Name"]}"
Location: "${company["City / State"] || company["Full Address"] || ""}"

Search Snippets:
${searchData.snippets.join('\n')}

Crawled Text:
${crawledData.combinedText.substring(0, 2000)}

LinkedIn URLs:
${searchData.linkedinUrls.join('\n')}

Extract and structure into JSON ONLY matching this format:
{
  "businessType": "Industry/Domain (e.g. Media, IT)",
  "website": "Main URL",
  "emails": ["email1", "email2"],
  "phones": ["phone1"],
  "linkedin": "Primary Company LinkedIn URL or Founder LinkedIn",
  "leadership": [ {"name": "...", "designation": "..."} ]
}
`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }], temperature: 0.1 })
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data) {
      throw new Error(data?.error?.message || `API Error ${res.status}`);
  }

  if (!data.choices || data.choices.length === 0) {
      throw new Error("AI returned empty response (Rate Limit likely)");
  }

  const textOutput = data.choices[0].message?.content || "{}";
  const match = textOutput.match(/\{[\s\S]*\}/);
  
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return {
        businessType: parsed.businessType || "Unknown",
        website: parsed.website || searchData.topUrls[0] || "",
        emails: Array.from(new Set([...(parsed.emails || []), ...crawledData.emails])),
        phones: Array.from(new Set([...(parsed.phones || []), ...crawledData.phones])),
        linkedin: parsed.linkedin || searchData.linkedinUrls.join(' | '),
        leadership: parsed.leadership || []
      };
    } catch (e) { console.warn("JSON Parse Error"); }
  }

  throw new Error("AI failed to return valid JSON");
}

// --- ENGINE CONTROLLER ---
async function startEnrichment() {
  isProcessing = true; isPaused = false;
  startEnrichBtn.disabled = true; pauseEnrichBtn.disabled = false; stopEnrichBtn.disabled = false;

  const apiKey = openRouterApiKeyEl.value.trim();
  const model = openRouterModelEl.value;
  const delaySec = parseFloat(delaySecEl.value) || 4;

  let currentIndex = enrichedResults.length;

  const updateMetrics = () => {
    metricProcessedEl.textContent = enrichedResults.length;
    let emailCount = 0, phoneCount = 0;
    enrichedResults.forEach(r => {
      emailCount += (r.emails || []).length;
      phoneCount += (r.phones || []).length;
    });
    metricEmailsEl.textContent = emailCount;
    metricPhonesEl.textContent = phoneCount;

    const pct = Math.round((enrichedResults.length / queuedRecords.length) * 100) || 0;
    progressBarEl.style.width = `${pct}%`;
  };

  while (isProcessing && currentIndex < queuedRecords.length) {
    if (isPaused) { await new Promise(r => setTimeout(r, 1000)); continue; }

    const itemIdx = currentIndex++;
    const item = queuedRecords[itemIdx];
    const rowEl = document.getElementById(`row-${itemIdx}`);

    if (rowEl) rowEl.querySelector('td:last-child').innerHTML = `<span class="badge badge-pending">Searching...</span>`;
    progressStatusEl.textContent = `Processing (${itemIdx + 1}/${queuedRecords.length}): ${item["Company Name"]}`;

    try {
      // 1. Search Web (Fallback Engine)
      const query = `"${item["Company Name"]}" ${item["City / State"] || ""} contact email linkedin`;
      const searchData = await searchWebEngines(query);

      // 2. Crawl top websites
      if (rowEl) rowEl.querySelector('td:last-child').innerHTML = `<span class="badge badge-pending">Crawling HTML...</span>`;
      const crawledData = await crawlWebsites(searchData.topUrls, searchData.linkedinUrls);

      // 3. AI Structuring
      if (rowEl) rowEl.querySelector('td:last-child').innerHTML = `<span class="badge badge-pending">AI Synthesizing...</span>`;
      const finalResult = await synthesizeWithAI(item, searchData, crawledData, apiKey, model);

      const enrichedRecord = {
        ...item,
        businessType: finalResult.businessType,
        website: finalResult.website,
        emails: finalResult.emails,
        phones: finalResult.phones,
        linkedin: finalResult.linkedin,
        leadership: finalResult.leadership
      };

      enrichedResults.push(enrichedRecord);

      // Update UI Row
      if (rowEl) {
        rowEl.querySelector('.col-type').textContent = enrichedRecord.businessType;
        rowEl.querySelector('.col-web').innerHTML = enrichedRecord.website ? `<a href="${enrichedRecord.website}" target="_blank">Website</a>` : '-';
        rowEl.querySelector('.col-emails').textContent = enrichedRecord.emails.join(', ') || '-';
        rowEl.querySelector('.col-phones').textContent = enrichedRecord.phones.join(', ') || '-';
        
        const leadStr = (enrichedRecord.leadership || []).map(l => `${l.name} (${l.designation})`).join('; ');
        rowEl.querySelector('.col-lead').innerHTML = `<div style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${leadStr}">${leadStr}<br><a href="${enrichedRecord.linkedin}" target="_blank">LinkedIn</a></div>`;
        rowEl.querySelector('td:last-child').innerHTML = `<span class="badge badge-success">Done</span>`;
      }

    } catch (err) {
      console.error(err);
      if (rowEl) {
          const msg = err.message || "Failed";
          rowEl.querySelector('td:last-child').innerHTML = `<span class="badge badge-error" title="${msg}">${msg}</span>`;
      }
      
      if (err.message.includes("429") || err.message.includes("Rate Limit")) {
          progressStatusEl.textContent = "Rate limited. Pausing for 10s...";
          await new Promise(r => setTimeout(r, 10000));
          currentIndex--; // Retry
          continue;
      }
    }

    updateMetrics();
    await new Promise(r => setTimeout(r, delaySec * 1000));
  }

  isProcessing = false; startEnrichBtn.disabled = false; pauseEnrichBtn.disabled = true; stopEnrichBtn.disabled = true;
  progressStatusEl.textContent = "Status: Completed!";
}

startEnrichBtn.addEventListener('click', startEnrichment);
pauseEnrichBtn.addEventListener('click', () => { isPaused = !isPaused; pauseEnrichBtn.textContent = isPaused ? "▶ Resume" : "⏸ Pause"; });
stopEnrichBtn.addEventListener('click', () => { isProcessing = false; });

// --- EXPORT DATA ---
document.getElementById('downloadEnrichedCsvBtn').addEventListener('click', () => {
  if (enrichedResults.length === 0) return alert("No enriched data to download yet.");
  const headers = ["Company Name", "CIN", "Status", "Business Type", "Website", "Emails", "Phones", "LinkedIn & Leadership", "Location", "Source File"];
  const rows = [headers.join(',')];

  enrichedResults.forEach(r => {
    const leadStr = (r.leadership || []).map(l => `${l.name} (${l.designation})`).join(' | ');
    const row = [
      `"${(r["Company Name"] || '').replace(/"/g, '""')}"`,
      `"${(r["CIN"] || '').replace(/"/g, '""')}"`,
      `"${(r["Status"] || '').replace(/"/g, '""')}"`,
      `"${(r.businessType || '').replace(/"/g, '""')}"`,
      `"${(r.website || '').replace(/"/g, '""')}"`,
      `"${(r.emails || []).join('; ')}"`,
      `"${(r.phones || []).join('; ')}"`,
      `"${[leadStr, r.linkedin].filter(Boolean).join(' | ').replace(/"/g, '""')}"`,
      `"${(r["City / State"] || r["Full Address"] || '').replace(/"/g, '""')}"`,
      `"${r._sourceFile || ''}"`
    ];
    rows.push(row.join(','));
  });

  const blob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Pro_Enriched_Leads_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});