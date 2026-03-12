import { getBiomedicalTools, getBiomedicalToolsets, disconnectBiomedicalMcp } from '../src/clients/biomedical-mcp.js';

console.log('Connecting to MCP servers...');
const start = Date.now();

const toolsets = await getBiomedicalToolsets();
const serverNames = Object.keys(toolsets);
console.log(`\nConnected servers (${serverNames.length}):`);
for (const name of serverNames.sort()) {
  const tools = Object.keys(toolsets[name] ?? {});
  console.log(`  ✓ ${name} → ${tools.length} tools`);
  tools.sort().forEach(t => console.log(`      ${t}`));
}

const allTools = await getBiomedicalTools();
const total = Object.keys(allTools).length;
console.log(`\nTotal tools: ${total}`);
console.log(`Time: ${((Date.now() - start) / 1000).toFixed(1)}s`);

await disconnectBiomedicalMcp();
process.exit(0);
