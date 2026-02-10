const http = require('http');
const https = require('https');
const url = require('url');

// FORCE SSL BYPASS
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PORT = process.env.PORT || 3000;
const BASE_URL = "https://coe.pgi-intraconnect.in/qpportal/app.php";

// ================== 1. THE BACKEND (Scraper Logic) ==================

const pad = (num) => num.toString().padStart(4, '0');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function secureGet(url) {
    return new Promise((resolve) => {
        const req = https.get(url, { rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}

async function scrapeData(res, batchPrefix, start, end, univCode, yearMode) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const sendMsg = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    let foundCount = 0;

    for (let i = start; i <= end; i++) {
        const regNo = `${batchPrefix}${pad(i)}`;
        sendMsg('log', `Fetching ${regNo}...`);

        const detUrl = `${BASE_URL}?db=pub&a=getDetailedResults&regno=${regNo}&univcode=${univCode}&yearmode=${yearMode}`;
        const detJson = await secureGet(detUrl);

        if (!detJson || detJson.status !== 'success' || !detJson.data || !detJson.data.studdet) {
            await sleep(20); 
            continue;
        }

        const briefUrl = `${BASE_URL}?db=pub&a=getBriefResults&regno=${regNo}&univcode=${univCode}&yearmode=${yearMode}`;
        const briefJson = await secureGet(briefUrl) || {};

        const info = detJson.data.studdet;
        const grades = detJson.data.resdata || [];
        const marks = (briefJson.data && briefJson.data.data) ? briefJson.data.data : [];

        const subjects = grades.map(g => {
            const markEntry = marks.find(m => m.subname.trim() === g.subname.trim());
            const breakdown = {};
            if (markEntry && markEntry.ssubname) {
                markEntry.ssubname.forEach((label, idx) => breakdown[label] = markEntry.marks[idx]);
            }
            return {
                subject: g.subname,
                code: g.subshort,
                grade: g.grade,
                credits: g.no_of_credits,
                marks: breakdown
            };
        });

        let sgpa = detJson.data.row2 ? detJson.data.row2.replace(/<[^>]*>/g, '').replace('SGPA:', '').trim() : "0.00";

        const studentData = {
            regno: info.regno,
            name: info.name,
            sgpa: sgpa, 
            results: subjects
        };

        sendMsg('result', studentData);
        foundCount++;
        await sleep(50);
    }
    sendMsg('done', { count: foundCount });
    res.end();
}

// ================== 2. THE FRONTEND (Mobile Optimized) ==================

const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Result Scraper</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; -webkit-tap-highlight-color: transparent; }
        .grade-O { color: #16a34a; font-weight: bold; }
        .grade-A_ { color: #22c55e; font-weight: bold; }
        .grade-A { color: #4ade80; font-weight: bold; }
        .grade-B_ { color: #fbbf24; font-weight: bold; }
        .grade-B { color: #f59e0b; font-weight: bold; }
        .grade-C { color: #f97316; font-weight: bold; }
        .grade-F { color: #dc2626; font-weight: bold; background: #fee2e2; padding: 2px 6px; border-radius: 4px; }
        .hidden-row { display: none; }
        .fade-in { animation: fadeIn 0.3s ease-in; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        
        /* Mobile Tweaks */
        input { font-size: 16px !important; } /* Prevents iOS zoom */
    </style>
</head>
<body class="bg-gray-100 min-h-screen text-slate-800 pb-12">

    <div class="bg-white shadow-sm sticky top-0 z-50 border-b border-gray-200">
        <div class="max-w-4xl mx-auto px-4 py-3">
            <div class="flex justify-between items-center cursor-pointer" onclick="toggleControls()">
                <h1 class="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center gap-2">
                    <span>🚀</span> Result Portal
                </h1>
                <span class="text-xs text-blue-500 font-medium bg-blue-50 px-2 py-1 rounded" id="toggleBtn">▼ Config</span>
            </div>
            
            <div id="controls" class="hidden mt-4 space-y-3 pb-2">
                <div class="grid grid-cols-1 gap-3">
                     <div>
                        <label class="text-xs font-semibold text-gray-500 uppercase">Batch Prefix</label>
                        <input type="text" id="batch" value="20241CAI" class="w-full mt-1 px-3 py-2 border rounded-lg font-mono uppercase focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-gray-50">
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-3">
                    <div class="col-span-1">
                        <label class="text-xs font-semibold text-gray-500 uppercase">Start</label>
                        <input type="number" id="start" value="1" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm bg-gray-50">
                    </div>
                    <div class="col-span-1">
                        <label class="text-xs font-semibold text-gray-500 uppercase">End</label>
                        <input type="number" id="end" value="60" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm bg-gray-50">
                    </div>
                    <div class="col-span-1">
                         <label class="text-xs font-semibold text-gray-500 uppercase">Year</label>
                         <input type="text" id="yearMode" value="C-2025-4" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm bg-gray-50 text-center">
                    </div>
                </div>

                <div class="flex gap-2 pt-2">
                    <button onclick="startScrape()" id="btnScrape" class="flex-1 py-2.5 bg-blue-600 active:bg-blue-800 text-white font-medium rounded-lg shadow-md transition-all text-sm flex justify-center items-center gap-2">
                        Start
                    </button>
                    <button onclick="downloadJSON()" id="btnDownload" class="hidden px-4 py-2.5 bg-green-600 active:bg-green-800 text-white font-medium rounded-lg shadow-md transition-all text-sm">
                        💾
                    </button>
                </div>
                
                <div id="logs" class="h-16 overflow-y-auto bg-gray-900 text-green-400 text-[10px] font-mono p-2 rounded-lg shadow-inner mt-2">
                    <div class="text-gray-500 italic">Ready...</div>
                </div>
            </div>
        </div>
    </div>

    <div class="max-w-4xl mx-auto px-4 mt-4">
        
        <div class="flex justify-between items-center mb-4 bg-white p-3 rounded-xl shadow-sm border border-gray-200">
            <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-gray-600">Found:</span>
                <span id="countBadge" class="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-0.5 rounded-full">0</span>
            </div>
            <input type="text" id="searchInput" onkeyup="filterTable()" placeholder="Search..." 
                   class="w-32 md:w-48 text-sm px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
        </div>

        <div class="space-y-3" id="resultList">
            <div id="emptyState" class="flex flex-col items-center justify-center py-12 text-gray-400">
                <div class="text-4xl mb-2">📡</div>
                <p class="text-sm">Tap "Config" then "Start"</p>
            </div>
        </div>
    </div>

    <script>
        let allStudents = [];
        let eventSource = null;
        let controlsOpen = false;

        function toggleControls() {
            const el = document.getElementById('controls');
            const btn = document.getElementById('toggleBtn');
            controlsOpen = !controlsOpen;
            if(controlsOpen) {
                el.classList.remove('hidden');
                btn.innerText = '▲ Hide';
            } else {
                el.classList.add('hidden');
                btn.innerText = '▼ Config';
            }
        }

        function log(msg) {
            const logs = document.getElementById('logs');
            logs.innerHTML = "> " + msg;
        }

        function startScrape() {
            allStudents = [];
            document.getElementById('resultList').innerHTML = '';
            document.getElementById('countBadge').innerText = '0';
            document.getElementById('emptyState').classList.add('hidden');
            document.getElementById('btnDownload').classList.add('hidden');
            document.getElementById('btnScrape').disabled = true;
            document.getElementById('btnScrape').classList.add('opacity-50');
            document.getElementById('btnScrape').innerText = 'Running...';

            // Auto-collapse controls on mobile after start
            if(window.innerWidth < 768 && controlsOpen) toggleControls();

            const params = new URLSearchParams({
                batch: document.getElementById('batch').value,
                start: document.getElementById('start').value,
                end: document.getElementById('end').value,
                year: document.getElementById('yearMode').value
            });
            
            if(eventSource) eventSource.close();
            eventSource = new EventSource('/api/scrape?' + params.toString());

            eventSource.onmessage = (event) => {
                const payload = JSON.parse(event.data);
                if (payload.type === 'log') log(payload.data);
                else if (payload.type === 'result') {
                    allStudents.push(payload.data);
                    // Sort descending by SGPA automatically
                    allStudents.sort((a,b) => parseFloat(b.sgpa) - parseFloat(a.sgpa));
                    renderList(); 
                } 
                else if (payload.type === 'done') {
                    eventSource.close();
                    document.getElementById('btnScrape').disabled = false;
                    document.getElementById('btnScrape').classList.remove('opacity-50');
                    document.getElementById('btnScrape').innerText = 'Start';
                    document.getElementById('btnDownload').classList.remove('hidden');
                }
            };
            eventSource.onerror = () => { eventSource.close(); document.getElementById('btnScrape').innerText = 'Retry'; };
        }

        function renderList(dataOverride) {
            const container = document.getElementById('resultList');
            const data = dataOverride || allStudents;
            container.innerHTML = '';
            
            document.getElementById('countBadge').innerText = data.length;

            data.forEach((student, index) => {
                let sgpaVal = parseFloat(student.sgpa);
                let badgeColor = "bg-gray-100 text-gray-800";
                if(sgpaVal >= 9) badgeColor = "bg-green-100 text-green-800 border-green-200";
                else if(sgpaVal >= 8) badgeColor = "bg-blue-100 text-blue-800 border-blue-200";
                else if(sgpaVal < 6 && sgpaVal > 0) badgeColor = "bg-red-50 text-red-600 border-red-100";

                const cardId = \`card-\${student.regno}\`;
                
                // Construct Subject HTML
                let subjectsHtml = student.results.map(sub => {
                    let gradeColor = sub.grade === 'F' ? 'text-red-600 bg-red-50' : 'text-gray-800';
                    let marksStr = Object.entries(sub.marks).map(([k,v]) => \`\${k}: <b>\${v}</b>\`).join(' | ');
                    
                    return \`
                    <div class="flex justify-between items-start py-2 border-b border-gray-100 last:border-0 text-xs md:text-sm">
                        <div class="w-2/3 pr-2">
                            <div class="font-medium text-gray-700 truncate">\${sub.subject}</div>
                            <div class="text-[10px] text-gray-400 mt-0.5">\${marksStr || 'No details'}</div>
                        </div>
                        <div class="font-bold \${gradeColor} px-2 py-0.5 rounded text-xs">\${sub.grade}</div>
                    </div>\`;
                }).join('');

                const div = document.createElement('div');
                div.className = "bg-white rounded-xl p-4 shadow-sm border border-gray-200 fade-in cursor-pointer active:bg-gray-50 transition-colors";
                div.onclick = () => {
                    const det = document.getElementById('det-' + student.regno);
                    det.classList.toggle('hidden');
                };

                div.innerHTML = \`
                    <div class="flex justify-between items-center">
                        <div class="flex items-center gap-3">
                            <div class="text-xs font-bold text-gray-400 w-6">#\${index+1}</div>
                            <div>
                                <div class="font-bold text-gray-900 text-sm md:text-base">\${student.name}</div>
                                <div class="text-[11px] font-mono text-gray-500">\${student.regno}</div>
                            </div>
                        </div>
                        <div class="flex items-center gap-3">
                            <div class="px-2.5 py-1 rounded-lg border \${badgeColor} text-xs md:text-sm font-bold shadow-sm">
                                \${student.sgpa}
                            </div>
                            <div class="text-gray-300 text-xs">▼</div>
                        </div>
                    </div>
                    <div id="det-\${student.regno}" class="hidden mt-4 pt-3 border-t border-dashed border-gray-200">
                        \${subjectsHtml}
                    </div>
                \`;
                container.appendChild(div);
            });
        }

        function filterTable() {
            const term = document.getElementById('searchInput').value.toLowerCase();
            const filtered = allStudents.filter(s => s.name.toLowerCase().includes(term) || s.regno.toLowerCase().includes(term));
            renderList(filtered);
        }

        function downloadJSON() {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allStudents, null, 2));
            const a = document.createElement('a');
            a.href = dataStr;
            a.download = "results.json";
            document.body.appendChild(a); a.click(); a.remove();
        }
    </script>
</body>
</html>
`;

// ================== 3. THE SERVER ==================

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(HTML_CONTENT);
    } 
    else if (parsedUrl.pathname === '/api/scrape') {
        const { batch, start, end, year } = parsedUrl.query;
        scrapeData(res, batch || '20241CAI', parseInt(start)||1, parseInt(end)||60, '064', year || 'C-2025-4');
    } 
    else {
        res.writeHead(404);
        res.end("Not Found");
    }
});

server.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
});
