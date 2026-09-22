/**
 * @fileoverview Memory Editor API Route Definitions
 * @description Programming mode control, full memory bulk download/upload, CSV/JSON I/O
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

/**
 * Create memory manager router
 * @param {Object} deps
 * @param {import('../scanner/programmingController')} deps.programmingController
 */
function createMemoryRoutes({ programmingController }) {
  const router = express.Router();

  // Cached sync progress state
  let currentProgress = { active: false, step: 'idle', percent: 0, message: '' };

  // --- Programming Mode Control ---

  router.post('/mode', async (req, res) => {
    try {
      const { action } = req.body;
      if (action === 'enter') {
        await programmingController.enterProgramMode();
        res.json({ mode: 'PRG' });
      } else if (action === 'exit') {
        await programmingController.exitProgramMode();
        res.json({ mode: 'Normal' });
      } else {
        res.status(400).json({ error: 'Invalid action' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Download all memory systems from scanner ---

  router.get('/all', async (req, res) => {
    try {
      currentProgress = { active: true, step: 'reading', percent: 0, message: 'Reading memory from scanner...' };
      const memoryTree = await programmingController.getAllMemory((prog) => {
        currentProgress = { active: true, ...prog };
      });
      currentProgress = { active: false, step: 'done', percent: 100, message: 'Read complete' };
      res.json({
        success: true,
        count: memoryTree.length,
        systems: memoryTree,
      });
    } catch (err) {
      currentProgress = { active: false, step: 'error', percent: 0, message: err.message };
      res.status(500).json({ error: err.message });
    }
  });

  // --- Upload all memory systems to scanner ---

  router.post('/all', async (req, res) => {
    try {
      const { systems } = req.body;
      if (!systems || !Array.isArray(systems)) {
        return res.status(400).json({ error: 'systems (array) parameter is required' });
      }

      currentProgress = { active: true, step: 'writing', percent: 0, message: 'Writing memory to scanner...' };
      const result = await programmingController.uploadAllMemory(systems, (prog) => {
        currentProgress = { active: true, ...prog };
      });
      currentProgress = { active: false, step: 'done', percent: 100, message: 'Write complete' };
      res.json(result);
    } catch (err) {
      currentProgress = { active: false, step: 'error', percent: 0, message: err.message };
      res.status(500).json({ error: err.message });
    }
  });

  // --- Check progress (polling) ---

  router.get('/progress', (req, res) => {
    res.json(currentProgress);
  });

  // --- Backup file list and restore ---

  router.get('/backups', (req, res) => {
    try {
      const backupDir = path.join(process.cwd(), 'config', 'backups');
      if (!fs.existsSync(backupDir)) {
        return res.json([]);
      }
      const files = fs
        .readdirSync(backupDir)
        .filter((f) => f.endsWith('.json'))
        .map((filename) => {
          const stats = fs.statSync(path.join(backupDir, filename));
          return {
            filename,
            size: stats.size,
            updatedAt: stats.mtime,
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      res.json(files);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/backups/:filename', (req, res) => {
    try {
      const backupDir = path.join(process.cwd(), 'config', 'backups');
      const safeFilename = path.basename(req.params.filename);
      const filePath = path.join(backupDir, safeFilename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Backup file not found' });
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json(JSON.parse(content));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- CSV Export ---

  router.get('/export/csv', async (req, res) => {
    try {
      const systems = await programmingController.getAllMemory();
      const rows = [
        ['System', 'Type', 'QuickKey', 'Group', 'Channel', 'Frequency', 'Modulation', 'Tone', 'Lockout', 'Priority', 'Attenuator'].join(','),
      ];

      for (const sys of systems) {
        for (const grp of sys.groups || []) {
          for (const chn of grp.channels || []) {
            rows.push(
              [
                `"${(sys.name || '').replace(/"/g, '""')}"`,
                sys.type || 'CNV',
                sys.quickKey !== null && sys.quickKey !== undefined ? sys.quickKey : '',
                `"${(grp.name || '').replace(/"/g, '""')}"`,
                `"${(chn.name || '').replace(/"/g, '""')}"`,
                chn.frequency || '',
                chn.modulation || 'AUTO',
                `"${(chn.tone || 'None / All').replace(/"/g, '""')}"`,
                chn.lockout ? 'Yes' : 'No',
                chn.priority ? 'Yes' : 'No',
                chn.attenuator ? 'Yes' : 'No',
              ].join(',')
            );
          }
        }
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="bct15x_channels.csv"');
      res.send(rows.join('\r\n'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- CSV Import ---

  router.post('/import/csv', express.text({ type: ['text/csv', 'text/plain'], limit: '10mb' }), (req, res) => {
    try {
      const csvText = req.body;
      if (!csvText || typeof csvText !== 'string') {
        return res.status(400).json({ error: 'CSV text body is required' });
      }

      const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        return res.status(400).json({ error: 'CSV header and data lines are required' });
      }

      // Simple CSV parser
      const parseCsvLine = (line) => {
        const result = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            result.push(cur.trim());
            cur = '';
          } else {
            cur += char;
          }
        }
        result.push(cur.trim());
        return result;
      };

      const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
      const sysCol = header.findIndex((h) => h.includes('system'));
      const grpCol = header.findIndex((h) => h.includes('group'));
      const chnCol = header.findIndex((h) => h.includes('channel') || h.includes('name'));
      const freqCol = header.findIndex((h) => h.includes('freq'));
      const modCol = header.findIndex((h) => h.includes('mod'));
      const toneCol = header.findIndex((h) => h.includes('tone'));

      if (freqCol === -1) {
        return res.status(400).json({ error: 'Frequency column not found in CSV header' });
      }

      const systemsMap = new Map();

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        if (!cols[freqCol]) continue;

        const sysName = (sysCol !== -1 && cols[sysCol]) || 'Default System';
        const grpName = (grpCol !== -1 && cols[grpCol]) || 'Default Group';
        const chnName = (chnCol !== -1 && cols[chnCol]) || `Ch ${i}`;
        const freq = cols[freqCol];
        const mod = (modCol !== -1 && cols[modCol]) || 'AUTO';
        const tone = (toneCol !== -1 && cols[toneCol]) || 'None / All';

        if (!systemsMap.has(sysName)) {
          systemsMap.set(sysName, {
            id: Math.floor(Math.random() * 1000) + 10,
            name: sysName,
            type: 'CNV',
            groups: new Map(),
          });
        }

        const sysObj = systemsMap.get(sysName);
        if (!sysObj.groups.has(grpName)) {
          sysObj.groups.set(grpName, {
            id: Math.floor(Math.random() * 1000) + 100,
            name: grpName,
            systemId: sysObj.id,
            channels: [],
          });
        }

        const grpObj = sysObj.groups.get(grpName);
        grpObj.channels.push({
          id: Math.floor(Math.random() * 10000) + 1000,
          name: chnName,
          frequency: freq,
          modulation: mod,
          tone: tone,
          systemId: sysObj.id,
          groupId: grpObj.id,
          lockout: false,
          priority: false,
          attenuator: false,
        });
      }

      // Convert map to JSON array
      const systems = Array.from(systemsMap.values()).map((s) => ({
        ...s,
        groups: Array.from(s.groups.values()),
      }));

      res.json({ success: true, count: systems.length, systems });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createMemoryRoutes;
