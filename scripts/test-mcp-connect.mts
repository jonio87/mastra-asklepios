import { biomedicalMcp } from '../src/clients/biomedical-mcp.js';

console.log('Connecting to 8 MCP servers...');
const start = Date.now();

try {
  const toolsets = await biomedicalMcp.getToolsets();
  const serverNames = Object.keys(toolsets);
  console.log(`\nConnected servers (${serverNames.length}/8):`);
  for (const name of serverNames) {
    const tools = Object.keys(toolsets[name] ?? {});
    console.log(`  ✓ ${name} → ${tools.length} tools: ${tools.slice(0, 8).join(', ')}${tools.length > 8 ? '...' : ''}`);
  }
  
  const allTools = await biomedicalMcp.getTools();
  console.log(`\nTotal tools: ${Object.keys(allTools).length}`);
  console.log(`Time: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  
  await biomedicalMcp.disconnect();
  process.exit(0);
} catch (e) {
  console.error('Error:', (e as Error).message);
  process.exit(1);
}
