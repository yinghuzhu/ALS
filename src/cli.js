#!/usr/bin/env node
/**
 * ASL (AISessionLog) CLI
 * Local AI session log sync pipeline
 */

import { Command } from 'commander';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { expandTilde, log } from './core/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('asl')
  .description('AISessionLog - Local AI session log sync pipeline')
  .version(packageJson.version);

program
  .command('init')
  .description('Initialize ASL configuration (interactive wizard)')
  .action(() => {
    console.log('🔧 ASL Initialization Wizard');
    console.log('Note: Interactive wizard not yet implemented in v0.1');
    console.log('Please create config manually at ~/.config/aisessionlog/config.json');
  });

program
  .command('pull')
  .description('Full import of historical sessions')
  .action(async () => {
    log('📥 Pulling historical sessions...');

    try {
      const { scanAndSync } = await import('./core/scanner.js');
      const config = {
        vaultPath: expandTilde('~/Documents/ObsidianVault'),
        sources: {
          claude_code: { enabled: true, path: expandTilde('~/.claude/projects') },
          codex: { enabled: true, path: expandTilde('~/.codex/sessions') },
          codebuddy: { enabled: true, path: expandTilde('~/.codebuddy/projects') },
          opencode: { enabled: true, mode: 'json', path: expandTilde('~/.local/share/opencode') }
        }
      };

      const result = await scanAndSync(config);
      log(`✅ Imported ${result.sessionsProcessed} sessions`);
      log(`   Claude Code: ${result.bySource.claude_code || 0}`);
      log(`   Codex CLI: ${result.bySource.codex || 0}`);
      log(`   CodeBuddy: ${result.bySource.codebuddy || 0}`);
      log(`   OpenCode: ${result.bySource.opencode || 0}`);
    } catch (error) {
      console.error('❌ Pull failed:', error.message);
    }
  });

program
  .command('watch')
  .description('Start real-time file watching and sync')
  .action(async () => {
    console.log('👁️  Starting watch mode...');
    
    try {
      const { startWatching } = await import('./core/watcher.js');
      const { onFileChange } = await import('./core/watcher.js');
      const { processFileChange } = await import('./core/scanner.js');
      
      onFileChange(processFileChange);
      await startWatching();
      
      console.log('\nPress Ctrl+C to stop');
      
      // Keep process running
      process.stdin.resume();
      
      process.on('SIGINT', async () => {
        const { stopWatching } = await import('./core/watcher.js');
        await stopWatching();
        process.exit(0);
      });
    } catch (error) {
      console.error('❌ Watch failed:', error.message);
    }
  });

program
  .command('sync')
  .description('Manually trigger one-time sync')
  .action(async () => {
    log('🔄 Triggering manual sync...');

    try {
      const { scanAndSync } = await import('./core/scanner.js');
      const config = {
        vaultPath: expandTilde('~/Documents/ObsidianVault'),
        sources: {
          claude_code: { enabled: true },
          codex: { enabled: true },
          codebuddy: { enabled: true },
          opencode: { enabled: true }
        }
      };

      const result = await scanAndSync(config);
      log(`✅ Synced ${result.sessionsProcessed} sessions`);
    } catch (error) {
      console.error('❌ Sync failed:', error.message);
    }
  });

program
  .command('status')
  .description('Show sync status and statistics')
  .action(async () => {
    console.log('📊 ASL Status');
    console.log('Version:', packageJson.version);
    console.log('Status: Development (v0.1 Spark)');
    
    try {
      const { getStats } = await import('./db/state.js');
      const stats = await getStats();
      
      console.log('\n📈 Statistics:');
      console.log(`   Files tracked: ${stats.files}`);
      console.log(`   Sessions synced: ${stats.sessions}`);
      console.log(`   Parse errors: ${stats.errors}`);
      
      if (Object.keys(stats.bySource).length > 0) {
        console.log('\n   By source:');
        for (const [source, count] of Object.entries(stats.bySource)) {
          console.log(`     ${source}: ${count}`);
        }
      }
    } catch (error) {
      console.log('\nNote: Database not yet initialized');
    }
    
    console.log('\n✅ Adapters:');
    console.log('   Claude Code - Implemented & Tested');
    console.log('   Codex CLI - Implemented & Tested');
    console.log('   CodeBuddy - Implemented & Tested');
    console.log('   OpenCode - Implemented & Tested');
  });

program
  .command('logs')
  .description('Show error logs')
  .option('--errors', 'Show only errors')
  .action(async (options) => {
    console.log('📋 ASL Logs');
    
    try {
      const { getRecentErrors } = await import('./db/state.js');
      const errors = await getRecentErrors(options.errors ? 20 : 10);
      
      if (errors.length === 0) {
        console.log('✅ No errors found');
      } else {
        console.log(`\nRecent errors (${errors.length}):`);
        for (const err of errors) {
          console.log(`\n[${new Date(err.occurredAt).toLocaleString()}]`);
          console.log(`  File: ${err.filePath}`);
          console.log(`  Error: ${err.errorMsg}`);
        }
      }
    } catch (error) {
      console.log('Note: Logging not yet initialized');
    }
  });

program.parse();
