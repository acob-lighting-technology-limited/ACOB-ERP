import * as fs from 'fs';
import * as path from 'path';

async function run() {
  const logPath = 'C:/Users/IT_COMMS/.gemini/antigravity/brain/3457f306-938a-4b3e-8824-8357fdc8c678/.system_generated/logs/transcript_full.jsonl';
  
  if (!fs.existsSync(logPath)) {
    console.error("Log file does not exist at:", logPath);
    process.exit(1);
  }

  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');

  console.log("Searching for get-2026-md-records output in logs...");

  let count = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      // Look for the step that executed the command and finished
      if (obj.content && obj.content.includes("TOTAL_2026_COUNT") && obj.content.includes("RECORD:")) {
        count++;
        console.log(`\nFound matching log entry #${count}:`);
        console.log(obj.content);
      }
    } catch (e) {
      // ignore parse errors
    }
  }
}

run();
